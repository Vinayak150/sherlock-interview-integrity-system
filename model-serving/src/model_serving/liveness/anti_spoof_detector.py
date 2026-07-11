"""Production visual liveness / anti-spoof detection."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np
from insightface.app import FaceAnalysis  # type: ignore[import-untyped]

from model_serving.liveness.detector import LIVENESS_THRESHOLD, LivenessResult
from model_serving.liveness.frame_format import decode_frame
from model_serving.liveness.liveness_errors import LivenessDetectionError, LivenessDetectionErrorCode

logger = logging.getLogger(__name__)

MODEL_INPUT_SIZE = 80


class SpoofCategory(StrEnum):
    LIVE = "LIVE"
    PRINTED_PHOTO = "PRINTED_PHOTO"
    PHONE_REPLAY = "PHONE_REPLAY"
    SCREEN_REPLAY = "SCREEN_REPLAY"
    SPOOF = "SPOOF"


@dataclass(frozen=True)
class LivenessDetectionResult:
    score: float
    is_live: bool
    liveness_score: float
    spoof_probability: float
    confidence: float
    inference_latency_ms: float
    spoof_category: SpoofCategory


class AntiSpoofBackend(Protocol):
    @property
    def name(self) -> str: ...

    def load(self) -> None: ...

    def classify(self, face_crop_bgr: np.ndarray) -> tuple[SpoofCategory, float, float]: ...


def _largest_face(faces: list[object]) -> object | None:
    if not faces:
        return None

    def area(face: object) -> float:
        bbox = getattr(face, "bbox")
        return float((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))

    return max(faces, key=area)


def _crop_face(image_bgr: np.ndarray, face: object, scale: float = 2.7) -> np.ndarray:
    bbox = getattr(face, "bbox")
    x1, y1, x2, y2 = (float(value) for value in bbox)
    width = x2 - x1
    height = y2 - y1
    center_x = (x1 + x2) / 2
    center_y = (y1 + y2) / 2
    half = scale * max(width, height) / 2
    left = int(max(0, center_x - half))
    right = int(min(image_bgr.shape[1], center_x + half))
    top = int(max(0, center_y - half))
    bottom = int(min(image_bgr.shape[0], center_y + half))
    crop = image_bgr[top:bottom, left:right]
    if crop.size == 0:
        raise LivenessDetectionError(
            LivenessDetectionErrorCode.DETECTION_FAILED,
            "failed to crop face region from frame",
        )
    return crop


def _preprocess_face_crop(face_crop_bgr: np.ndarray) -> np.ndarray:
    resized = cv2.resize(face_crop_bgr, (MODEL_INPUT_SIZE, MODEL_INPUT_SIZE))
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32)
    return (rgb - 127.5) / 128.0


def _softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - np.max(logits)
    exp = np.exp(shifted)
    return exp / np.sum(exp)


class MiniFasNetOnnxBackend:
    """MiniFASNet anti-spoof ONNX backend (CPU inference)."""

    def __init__(self, model_path: str | None = None) -> None:
        self._model_path = model_path
        self._session: object | None = None

    @property
    def name(self) -> str:
        return "minifasnet"

    def load(self) -> None:
        if self._session is not None:
            return

        path = self._resolve_model_path()
        import onnxruntime as ort  # type: ignore[import-untyped]

        self._session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        logger.info("loaded MiniFASNet ONNX backend path=%s", path)

    def _resolve_model_path(self) -> str:
        if self._model_path is not None and Path(self._model_path).is_file():
            return self._model_path

        candidates = [
            Path("resources/anti_spoof_models/minifasnet.onnx"),
            Path("pretrained_models/minifasnet.onnx"),
        ]
        for candidate in candidates:
            if candidate.is_file():
                return str(candidate)

        raise FileNotFoundError("MiniFASNet ONNX model not found")

    def classify(self, face_crop_bgr: np.ndarray) -> tuple[SpoofCategory, float, float]:
        if self._session is None:
            raise RuntimeError("MiniFasNetOnnxBackend.load() must be called before classify()")

        tensor = _preprocess_face_crop(face_crop_bgr)
        input_name = self._session.get_inputs()[0].name  # type: ignore[union-attr]
        outputs = self._session.run(None, {input_name: np.expand_dims(tensor, axis=0)})  # type: ignore[union-attr]
        probabilities = _softmax(np.asarray(outputs[0], dtype=np.float64).reshape(-1))

        if probabilities.size >= 3:
            live_probability = float(probabilities[0])
            print_probability = float(probabilities[1])
            replay_probability = float(probabilities[2])
            spoof_probability = print_probability + replay_probability
            category_index = int(np.argmax(probabilities))
            category = (
                SpoofCategory.LIVE
                if category_index == 0
                else SpoofCategory.PRINTED_PHOTO
                if category_index == 1
                else SpoofCategory.PHONE_REPLAY
            )
            confidence = float(np.max(probabilities))
            return category, live_probability, confidence

        live_probability = float(probabilities[0])
        spoof_probability = float(probabilities[1]) if probabilities.size > 1 else 1.0 - live_probability
        category = SpoofCategory.LIVE if live_probability >= spoof_probability else SpoofCategory.SPOOF
        confidence = float(max(live_probability, spoof_probability))
        return category, live_probability, confidence


class SilentFaceOnnxBackend:
    """SilentFace ONNX fallback backend."""

    def __init__(self, model_path: str | None = None) -> None:
        self._model_path = model_path
        self._session: object | None = None

    @property
    def name(self) -> str:
        return "silentface"

    def load(self) -> None:
        if self._session is not None:
            return

        path = self._resolve_model_path()
        import onnxruntime as ort  # type: ignore[import-untyped]

        self._session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        logger.info("loaded SilentFace ONNX backend path=%s", path)

    def _resolve_model_path(self) -> str:
        if self._model_path is not None and Path(self._model_path).is_file():
            return self._model_path

        candidates = [
            Path("resources/anti_spoof_models/silentface.onnx"),
            Path("pretrained_models/silentface.onnx"),
        ]
        for candidate in candidates:
            if candidate.is_file():
                return str(candidate)

        raise FileNotFoundError("SilentFace ONNX model not found")

    def classify(self, face_crop_bgr: np.ndarray) -> tuple[SpoofCategory, float, float]:
        if self._session is None:
            raise RuntimeError("SilentFaceOnnxBackend.load() must be called before classify()")

        tensor = _preprocess_face_crop(face_crop_bgr)
        input_name = self._session.get_inputs()[0].name  # type: ignore[union-attr]
        outputs = self._session.run(None, {input_name: np.expand_dims(tensor, axis=0)})  # type: ignore[union-attr]
        probabilities = _softmax(np.asarray(outputs[0], dtype=np.float64).reshape(-1))
        live_probability = float(probabilities[0])
        spoof_probability = float(1.0 - live_probability)
        category = SpoofCategory.LIVE if live_probability >= 0.5 else SpoofCategory.SCREEN_REPLAY
        confidence = float(max(live_probability, spoof_probability))
        return category, live_probability, confidence


class SignalHeuristicAntiSpoofBackend:
    """CPU-only heuristic backend used when ONNX models are unavailable."""

    @property
    def name(self) -> str:
        return "signal-heuristic"

    def load(self) -> None:
        return

    def classify(self, face_crop_bgr: np.ndarray) -> tuple[SpoofCategory, float, float]:
        gray = cv2.cvtColor(face_crop_bgr, cv2.COLOR_BGR2GRAY)
        laplacian_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        color_std = float(np.std(face_crop_bgr.astype(np.float32)))
        stripe_strength = float(np.std(np.diff(gray.mean(axis=1))))

        if laplacian_variance < 5 and color_std < 30:
            return SpoofCategory.PRINTED_PHOTO, 0.12, 0.82
        if stripe_strength > 35:
            return SpoofCategory.SCREEN_REPLAY, 0.18, 0.78
        if stripe_strength > 20 and laplacian_variance < 12_000:
            return SpoofCategory.PHONE_REPLAY, 0.22, 0.74

        live_score = min(1.0, (laplacian_variance / 12_000.0) * min(1.0, color_std / 40.0))
        confidence = max(live_score, 1.0 - live_score)
        return SpoofCategory.LIVE, live_score, confidence


class DeterministicTestAntiSpoofBackend:
    """Deterministic backend for unit tests without heavyweight model downloads."""

    @property
    def name(self) -> str:
        return "deterministic-test"

    def load(self) -> None:
        return

    def classify(self, face_crop_bgr: np.ndarray) -> tuple[SpoofCategory, float, float]:
        gray = cv2.cvtColor(face_crop_bgr, cv2.COLOR_BGR2GRAY)
        laplacian_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        color_std = float(np.std(face_crop_bgr.astype(np.float32)))
        stripe_strength = float(np.std(np.diff(gray.mean(axis=1))))

        if laplacian_variance < 5 and color_std < 30:
            return SpoofCategory.PRINTED_PHOTO, 0.08, 0.9
        if stripe_strength > 35:
            return SpoofCategory.SCREEN_REPLAY, 0.1, 0.88
        if stripe_strength > 20 and laplacian_variance < 12_000:
            return SpoofCategory.PHONE_REPLAY, 0.15, 0.85

        return SpoofCategory.LIVE, 0.92, 0.93


def _load_backend(
    minifasnet_model_path: str | None,
    silentface_model_path: str | None,
) -> AntiSpoofBackend:
    mini_backend = MiniFasNetOnnxBackend(minifasnet_model_path)
    try:
        mini_backend.load()
        return mini_backend
    except Exception as exc:  # noqa: BLE001 -- fallback path by design
        logger.warning("MiniFASNet backend unavailable, trying SilentFace: %s", exc)

    silent_backend = SilentFaceOnnxBackend(silentface_model_path)
    try:
        silent_backend.load()
        return silent_backend
    except Exception as exc:  # noqa: BLE001 -- heuristic fallback for CPU-only deploys
        logger.warning("SilentFace backend unavailable, using signal heuristic: %s", exc)

    heuristic = SignalHeuristicAntiSpoofBackend()
    heuristic.load()
    return heuristic


class ProductionLivenessDetector:
    """Loads anti-spoof models once and serves per-frame liveness scoring."""

    def __init__(
        self,
        backend: AntiSpoofBackend | None = None,
        *,
        model_name: str = "buffalo_l",
        det_size: tuple[int, int] = (640, 640),
        minifasnet_model_path: str | None = None,
        silentface_model_path: str | None = None,
    ) -> None:
        self._backend = backend
        self._model_name = model_name
        self._det_size = det_size
        self._minifasnet_model_path = minifasnet_model_path
        self._silentface_model_path = silentface_model_path
        self._analyzer: FaceAnalysis | None = None
        self._loaded = backend is not None

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def backend_name(self) -> str | None:
        return None if self._backend is None else self._backend.name

    def load(self) -> None:
        if self._loaded:
            return

        if self._backend is None:
            self._backend = _load_backend(self._minifasnet_model_path, self._silentface_model_path)

        logger.info("loading InsightFace detector for liveness model_name=%s", self._model_name)
        analyzer = FaceAnalysis(name=self._model_name, providers=["CPUExecutionProvider"])
        analyzer.prepare(ctx_id=0, det_size=self._det_size)
        self._analyzer = analyzer
        self._loaded = True
        logger.info("liveness anti-spoof backend ready backend=%s", self._backend.name)

    def detect_with_metadata(self, payload: bytes) -> LivenessDetectionResult:
        if self._analyzer is None or self._backend is None:
            raise RuntimeError("ProductionLivenessDetector.load() must be called before detect()")

        started = time.perf_counter()
        frame = decode_frame(payload)
        faces = self._analyzer.get(frame.image_bgr)

        if not faces:
            raise LivenessDetectionError(
                LivenessDetectionErrorCode.NO_FACE_DETECTED,
                "no face detected in frame",
            )
        if len(faces) > 1:
            raise LivenessDetectionError(
                LivenessDetectionErrorCode.MULTIPLE_FACES,
                "multiple faces detected in frame",
            )

        face = _largest_face(faces)
        if face is None:
            raise LivenessDetectionError(
                LivenessDetectionErrorCode.NO_FACE_DETECTED,
                "no face detected in frame",
            )

        detection_confidence = float(getattr(face, "det_score", 0.0))
        face_crop = _crop_face(frame.image_bgr, face)

        try:
            category, live_probability, model_confidence = self._backend.classify(face_crop)
        except LivenessDetectionError:
            raise
        except Exception as exc:  # noqa: BLE001 -- converted to structured detection failure
            raise LivenessDetectionError(
                LivenessDetectionErrorCode.DETECTION_FAILED,
                f"liveness detection failed: {exc}",
            ) from exc

        liveness_score = float(max(0.0, min(1.0, live_probability)))
        spoof_probability = float(max(0.0, min(1.0, 1.0 - liveness_score)))
        confidence = float(max(0.0, min(1.0, model_confidence * max(detection_confidence, 0.5))))
        is_live = liveness_score >= LIVENESS_THRESHOLD and category == SpoofCategory.LIVE
        latency_ms = (time.perf_counter() - started) * 1000.0

        return LivenessDetectionResult(
            score=liveness_score,
            is_live=is_live,
            liveness_score=liveness_score,
            spoof_probability=spoof_probability,
            confidence=confidence,
            inference_latency_ms=latency_ms,
            spoof_category=category,
        )

    def detect(self, payload: bytes) -> LivenessResult:
        result = self.detect_with_metadata(payload)
        return LivenessResult(score=result.score, is_live=result.is_live)
