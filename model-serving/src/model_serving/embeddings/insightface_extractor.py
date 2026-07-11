"""InsightFace-backed face embedding extraction."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import cv2
import numpy as np
from insightface.app import FaceAnalysis  # type: ignore[import-untyped]

from model_serving.embeddings.extractor import (
    EMBEDDING_DIMENSION,
    FaceExtractionResult,
    NoFaceDetectedError,
)

if TYPE_CHECKING:
    from numpy.typing import NDArray

logger = logging.getLogger(__name__)


def _largest_face(faces: list[object]) -> object | None:
    if not faces:
        return None

    def area(face: object) -> float:
        bbox = getattr(face, "bbox")
        return float((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))

    return max(faces, key=area)


def _normalize_embedding(embedding: NDArray[np.floating]) -> list[float]:
    norm = float(np.linalg.norm(embedding))
    if norm == 0.0:
        raise ValueError("embedding norm must not be zero")
    normalized = (embedding / norm).astype(np.float64)
    return [float(value) for value in normalized.tolist()]


class InsightFaceEmbeddingExtractor:
    """Loads InsightFace once, then serves normalized face embeddings per frame."""

    def __init__(self, model_name: str = "buffalo_l", det_size: tuple[int, int] = (640, 640)) -> None:
        self._model_name = model_name
        self._det_size = det_size
        self._analyzer: FaceAnalysis | None = None

    @property
    def is_loaded(self) -> bool:
        return self._analyzer is not None

    def load(self) -> None:
        if self._analyzer is not None:
            return

        logger.info(
            "loading InsightFace model model_name=%s det_size=%s",
            self._model_name,
            self._det_size,
        )
        analyzer = FaceAnalysis(name=self._model_name, providers=["CPUExecutionProvider"])
        analyzer.prepare(ctx_id=0, det_size=self._det_size)
        self._analyzer = analyzer
        logger.info("InsightFace model loaded")

    def extract_with_metadata(self, payload: bytes) -> FaceExtractionResult:
        if len(payload) == 0:
            raise ValueError("payload must not be empty")
        if self._analyzer is None:
            raise RuntimeError("InsightFaceEmbeddingExtractor.load() must be called before extract()")

        image_array = np.frombuffer(payload, dtype=np.uint8)
        image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("payload must be a valid encoded image")

        faces = self._analyzer.get(image)
        face = _largest_face(faces)
        if face is None:
            raise NoFaceDetectedError("No face detected in frame")

        raw_embedding = np.asarray(getattr(face, "embedding"), dtype=np.float64)
        if raw_embedding.shape[0] != EMBEDDING_DIMENSION:
            raise ValueError(
                f"expected {EMBEDDING_DIMENSION}-dimensional embedding, got {raw_embedding.shape[0]}"
            )

        detection_confidence = float(getattr(face, "det_score", 0.0))
        return FaceExtractionResult(
            embedding=_normalize_embedding(raw_embedding),
            detection_confidence=detection_confidence,
        )

    @property
    def model_name(self) -> str:
        return self._model_name

    def extract(self, payload: bytes) -> list[float]:
        return self.extract_with_metadata(payload).embedding
