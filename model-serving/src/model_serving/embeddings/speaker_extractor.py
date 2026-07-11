"""Production speaker-embedding extraction with pyannote / SpeechBrain backends."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from model_serving.embeddings.audio_format import decode_wav_mono_16k
from model_serving.embeddings.vad import detect_speech_activity
from model_serving.embeddings.voice_errors import VoiceExtractionError, VoiceExtractionErrorCode

logger = logging.getLogger(__name__)

OVERLAP_SEGMENT_COUNT = 3
OVERLAP_SIMILARITY_THRESHOLD = 0.55


@dataclass(frozen=True)
class VoiceExtractionResult:
    embedding: list[float]
    embedding_dimension: int
    confidence: float
    speech_duration: float
    speech_ratio: float
    inference_latency_ms: float


class SpeakerEmbeddingBackend(Protocol):
    @property
    def name(self) -> str: ...

    def embed(self, samples: np.ndarray, sample_rate: int) -> np.ndarray: ...


def _normalize_embedding(embedding: np.ndarray) -> list[float]:
    norm = float(np.linalg.norm(embedding))
    if norm == 0.0:
        raise VoiceExtractionError(
            VoiceExtractionErrorCode.EXTRACTION_FAILED,
            "speaker embedding norm must not be zero",
        )
    normalized = (embedding / norm).astype(np.float64)
    return [float(value) for value in normalized.tolist()]


def _cosine_similarity(left: np.ndarray, right: np.ndarray) -> float:
    left_norm = float(np.linalg.norm(left))
    right_norm = float(np.linalg.norm(right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return float(np.dot(left, right) / (left_norm * right_norm))


class PyannoteSpeakerBackend:
    def __init__(self) -> None:
        self._inference: object | None = None

    @property
    def name(self) -> str:
        return "pyannote"

    def load(self) -> None:
        if self._inference is not None:
            return
        from pyannote.audio import Inference  # type: ignore[import-untyped]

        self._inference = Inference("pyannote/embedding", window="whole")
        logger.info("loaded pyannote speaker embedding backend")

    def embed(self, samples: np.ndarray, sample_rate: int) -> np.ndarray:
        if self._inference is None:
            raise RuntimeError("PyannoteSpeakerBackend.load() must be called before embed()")

        import torch  # type: ignore[import-untyped]

        waveform = torch.from_numpy(samples.astype(np.float32)).unsqueeze(0)
        output = self._inference({"waveform": waveform, "sample_rate": sample_rate})
        embedding = np.asarray(output, dtype=np.float64).reshape(-1)
        return embedding


class SpeechBrainSpeakerBackend:
    def __init__(self) -> None:
        self._classifier: object | None = None

    @property
    def name(self) -> str:
        return "speechbrain-ecapa"

    def load(self) -> None:
        if self._classifier is not None:
            return
        from speechbrain.inference.speaker import EncoderClassifier  # type: ignore[import-untyped]

        self._classifier = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir="pretrained_models/spkrec-ecapa-voxceleb",
            run_opts={"device": "cpu"},
        )
        logger.info("loaded SpeechBrain ECAPA-TDNN speaker embedding backend")

    def embed(self, samples: np.ndarray, sample_rate: int) -> np.ndarray:
        if self._classifier is None:
            raise RuntimeError("SpeechBrainSpeakerBackend.load() must be called before embed()")

        import torch  # type: ignore[import-untyped]

        waveform = torch.from_numpy(samples.astype(np.float32)).unsqueeze(0)
        with torch.no_grad():
            embedding = self._classifier.encode_batch(waveform)  # type: ignore[union-attr]
        return np.asarray(embedding.squeeze().cpu().numpy(), dtype=np.float64).reshape(-1)


class DeterministicTestSpeakerBackend:
    """CPU-only deterministic backend for unit tests without heavyweight model downloads."""

    @property
    def name(self) -> str:
        return "deterministic-test"

    def load(self) -> None:
        return

    def _feature_embedding(self, samples: np.ndarray) -> np.ndarray:
        if samples.size == 0:
            raise ValueError("samples must not be empty")

        spectrum = np.abs(np.fft.rfft(samples.astype(np.float64))[:128])
        peak_bin = int(np.argmax(spectrum))
        rms = float(np.sqrt(np.mean(samples * samples)))
        features = np.zeros(192, dtype=np.float64)
        features[peak_bin % 192] = 1.0
        features[(peak_bin * 7 + 3) % 192] = rms
        features[(peak_bin * 13 + 11) % 192] = float(np.max(spectrum))
        return features

    def embed(self, samples: np.ndarray, sample_rate: int) -> np.ndarray:
        del sample_rate
        return self._feature_embedding(samples)


def _load_backend() -> SpeakerEmbeddingBackend:
    pyannote_backend = PyannoteSpeakerBackend()
    try:
        pyannote_backend.load()
        return pyannote_backend
    except Exception as exc:  # noqa: BLE001 -- fallback path by design
        logger.warning("pyannote speaker backend unavailable, falling back to SpeechBrain: %s", exc)

    speechbrain_backend = SpeechBrainSpeakerBackend()
    try:
        speechbrain_backend.load()
        return speechbrain_backend
    except Exception as exc:  # noqa: BLE001 -- surfaced at startup in production
        raise RuntimeError("failed to load any speaker embedding backend") from exc


def _detect_overlapping_speakers(
    samples: np.ndarray,
    sample_rate: int,
    backend: SpeakerEmbeddingBackend,
) -> None:
    if samples.size < sample_rate:
        return

    segment_size = samples.size // OVERLAP_SEGMENT_COUNT
    if segment_size < int(sample_rate * 0.1):
        return

    segment_embeddings: list[np.ndarray] = []
    for index in range(OVERLAP_SEGMENT_COUNT):
        start = index * segment_size
        end = start + segment_size if index < OVERLAP_SEGMENT_COUNT - 1 else samples.size
        segment = samples[start:end]
        if segment.size < int(sample_rate * 0.1):
            continue
        segment_embeddings.append(backend.embed(segment, sample_rate))

    if len(segment_embeddings) < 2:
        return

    similarities = [
        _cosine_similarity(segment_embeddings[0], segment_embeddings[index])
        for index in range(1, len(segment_embeddings))
    ]
    if any(similarity < OVERLAP_SIMILARITY_THRESHOLD for similarity in similarities):
        raise VoiceExtractionError(
            VoiceExtractionErrorCode.OVERLAPPING_SPEAKERS,
            "segment embeddings diverged, indicating overlapping speakers",
        )


class SpeakerEmbeddingExtractor:
    """Loads a speaker model once, then serves normalized embeddings per request."""

    def __init__(self, backend: SpeakerEmbeddingBackend | None = None) -> None:
        self._backend = backend
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
        self._backend = _load_backend()
        self._loaded = True
        logger.info("speaker embedding backend ready backend=%s", self._backend.name)

    def extract_with_metadata(self, payload: bytes) -> VoiceExtractionResult:
        if len(payload) == 0:
            raise VoiceExtractionError(
                VoiceExtractionErrorCode.CORRUPTED_AUDIO,
                "payload must not be empty",
            )
        if self._backend is None:
            raise RuntimeError("SpeakerEmbeddingExtractor.load() must be called before extract()")

        started = time.perf_counter()
        decoded = decode_wav_mono_16k(payload)
        activity = detect_speech_activity(decoded.samples, decoded.sample_rate)

        try:
            _detect_overlapping_speakers(
                activity.speech_samples,
                decoded.sample_rate,
                self._backend,
            )
            raw_embedding = self._backend.embed(activity.speech_samples, decoded.sample_rate)
        except VoiceExtractionError:
            raise
        except Exception as exc:  # noqa: BLE001 -- converted to structured extraction failure
            raise VoiceExtractionError(
                VoiceExtractionErrorCode.EXTRACTION_FAILED,
                f"speaker embedding extraction failed: {exc}",
            ) from exc

        embedding = _normalize_embedding(raw_embedding)
        confidence = min(
            1.0,
            max(
                0.0,
                activity.speech_ratio * min(1.0, max(0.0, activity.snr_db / 30.0)),
            ),
        )
        latency_ms = (time.perf_counter() - started) * 1000.0

        return VoiceExtractionResult(
            embedding=embedding,
            embedding_dimension=len(embedding),
            confidence=confidence,
            speech_duration=activity.speech_duration,
            speech_ratio=activity.speech_ratio,
            inference_latency_ms=latency_ms,
        )

    def extract(self, payload: bytes) -> list[float]:
        return self.extract_with_metadata(payload).embedding
