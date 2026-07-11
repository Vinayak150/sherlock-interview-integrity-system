"""The Model-Serving Layer's HTTP surface (Plan M8)."""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

from fastapi import FastAPI, HTTPException

from model_serving.embeddings.extractor import EmbeddingExtractor, NoFaceDetectedError, StubEmbeddingExtractor
from model_serving.embeddings.insightface_extractor import InsightFaceEmbeddingExtractor
from model_serving.embeddings.speaker_extractor import SpeakerEmbeddingExtractor
from model_serving.embeddings.voice_errors import VoiceExtractionError, VoiceExtractionErrorCode
from model_serving.liveness.anti_spoof_detector import ProductionLivenessDetector
from model_serving.liveness.detector import LivenessDetector, StubLivenessDetector
from model_serving.liveness.liveness_errors import LivenessDetectionError, LivenessDetectionErrorCode
from model_serving.observability.metrics import (
    METRIC_CONFIDENCE_DISTRIBUTION,
    METRIC_FACE_CONFIDENCE_DISTRIBUTION,
    METRIC_INFERENCE_LATENCY_MS,
    METRIC_MODEL_VERSION,
    METRIC_SPEAKER_CONFIDENCE_DISTRIBUTION,
    METRIC_SPOOF_DETECTION_RATE,
    confidence_bucket,
    log_ai_metric,
)
from model_serving.serving_api.schemas import (
    EmbeddingResponse,
    HealthResponse,
    InferenceRequest,
    LivenessErrorResponse,
    LivenessResponse,
    NoFaceResponse,
    VoiceEmbeddingResponse,
    VoiceErrorResponse,
)

if TYPE_CHECKING:
    from model_serving.observability.model_registry import ModelVersionRegistry

VOICE_CLIENT_ERROR_CODES = {
    VoiceExtractionErrorCode.INVALID_AUDIO_FORMAT,
    VoiceExtractionErrorCode.UNSUPPORTED_SAMPLE_RATE,
    VoiceExtractionErrorCode.UNSUPPORTED_CHANNELS,
    VoiceExtractionErrorCode.CORRUPTED_AUDIO,
}

VOICE_NO_SIGNAL_CODES = {
    VoiceExtractionErrorCode.NO_SPEECH_DETECTED,
    VoiceExtractionErrorCode.CLIP_TOO_SHORT,
    VoiceExtractionErrorCode.OVERLAPPING_SPEAKERS,
    VoiceExtractionErrorCode.NOISY_AUDIO,
}


def _voice_error_status(code: VoiceExtractionErrorCode) -> int:
    if code in VOICE_CLIENT_ERROR_CODES:
        return 422
    if code in VOICE_NO_SIGNAL_CODES:
        return 404
    return 500


LIVENESS_CLIENT_ERROR_CODES = {
    LivenessDetectionErrorCode.CORRUPTED_FRAME,
    LivenessDetectionErrorCode.UNSUPPORTED_IMAGE_FORMAT,
    LivenessDetectionErrorCode.LOW_RESOLUTION,
}

LIVENESS_NO_SIGNAL_CODES = {
    LivenessDetectionErrorCode.NO_FACE_DETECTED,
    LivenessDetectionErrorCode.MULTIPLE_FACES,
}


def _liveness_error_status(code: LivenessDetectionErrorCode) -> int:
    if code in LIVENESS_CLIENT_ERROR_CODES:
        return 422
    if code in LIVENESS_NO_SIGNAL_CODES:
        return 404
    return 500


def create_app(
    face_extractor: EmbeddingExtractor | None = None,
    voice_extractor: EmbeddingExtractor | SpeakerEmbeddingExtractor | None = None,
    liveness_detector: LivenessDetector | ProductionLivenessDetector | None = None,
    *,
    observability_logger: logging.Logger | None = None,
    model_versions: ModelVersionRegistry | None = None,
) -> FastAPI:
    resolved_face_extractor = face_extractor or StubEmbeddingExtractor()
    resolved_voice_extractor = voice_extractor or StubEmbeddingExtractor()
    resolved_liveness_detector = liveness_detector or StubLivenessDetector()

    def _record_model_version(endpoint: str) -> None:
        if observability_logger is None or model_versions is None:
            return
        log_ai_metric(
            observability_logger,
            metric_name=METRIC_MODEL_VERSION,
            metric_type="info",
            value=1,
            labels=model_versions.label_set(endpoint),
        )

    def _record_inference_latency(endpoint: str, latency_ms: float) -> None:
        if observability_logger is None or model_versions is None:
            return
        labels = model_versions.label_set(endpoint)
        log_ai_metric(
            observability_logger,
            metric_name=METRIC_INFERENCE_LATENCY_MS,
            metric_type="histogram",
            value=latency_ms,
            labels=labels,
        )

    app = FastAPI(title="Sherlock Model-Serving Layer")

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok")

    @app.post(
        "/v1/embeddings/face",
        response_model=EmbeddingResponse,
        responses={404: {"model": NoFaceResponse}},
    )
    def embed_face(request: InferenceRequest) -> EmbeddingResponse:
        _record_model_version("/v1/embeddings/face")
        started = time.perf_counter()
        try:
            if isinstance(resolved_face_extractor, InsightFaceEmbeddingExtractor):
                result = resolved_face_extractor.extract_with_metadata(request.decoded_payload())
                embedding = result.embedding
                if observability_logger is not None and model_versions is not None:
                    log_ai_metric(
                        observability_logger,
                        metric_name=METRIC_FACE_CONFIDENCE_DISTRIBUTION,
                        metric_type="counter",
                        value=1,
                        labels={
                            **model_versions.label_set("/v1/embeddings/face"),
                            "bucket": confidence_bucket(result.detection_confidence),
                            "sessionId": request.session_id,
                        },
                    )
            else:
                embedding = resolved_face_extractor.extract(request.decoded_payload())
        except NoFaceDetectedError as exc:
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "NO_FACE",
                    "sessionId": request.session_id,
                    "message": str(exc),
                },
            ) from exc
        finally:
            _record_inference_latency("/v1/embeddings/face", (time.perf_counter() - started) * 1000.0)

        return EmbeddingResponse(
            session_id=request.session_id, embedding=embedding, dimension=len(embedding)
        )

    @app.post(
        "/v1/embeddings/voice",
        response_model=VoiceEmbeddingResponse,
        responses={
            404: {"model": VoiceErrorResponse},
            422: {"model": VoiceErrorResponse},
            500: {"model": VoiceErrorResponse},
        },
    )
    def embed_voice(request: InferenceRequest) -> VoiceEmbeddingResponse:
        _record_model_version("/v1/embeddings/voice")
        started = time.perf_counter()
        try:
            if isinstance(resolved_voice_extractor, SpeakerEmbeddingExtractor):
                result = resolved_voice_extractor.extract_with_metadata(request.decoded_payload())
                if observability_logger is not None and model_versions is not None:
                    log_ai_metric(
                        observability_logger,
                        metric_name=METRIC_SPEAKER_CONFIDENCE_DISTRIBUTION,
                        metric_type="counter",
                        value=1,
                        labels={
                            **model_versions.label_set("/v1/embeddings/voice"),
                            "bucket": confidence_bucket(result.confidence),
                            "sessionId": request.session_id,
                        },
                    )
                return VoiceEmbeddingResponse(
                    session_id=request.session_id,
                    embedding=result.embedding,
                    dimension=result.embedding_dimension,
                    confidence=result.confidence,
                    speech_duration=result.speech_duration,
                    speech_ratio=result.speech_ratio,
                    inference_latency=result.inference_latency_ms,
                )

            embedding = resolved_voice_extractor.extract(request.decoded_payload())
            return VoiceEmbeddingResponse(
                session_id=request.session_id,
                embedding=embedding,
                dimension=len(embedding),
                confidence=1.0,
                speech_duration=0.0,
                speech_ratio=1.0,
                inference_latency=0.0,
            )
        except VoiceExtractionError as exc:
            raise HTTPException(
                status_code=_voice_error_status(exc.code),
                detail={
                    "error": exc.code.value,
                    "sessionId": request.session_id,
                    "message": exc.message,
                },
            ) from exc
        finally:
            _record_inference_latency("/v1/embeddings/voice", (time.perf_counter() - started) * 1000.0)

    @app.post(
        "/v1/liveness/visual",
        response_model=LivenessResponse,
        responses={
            404: {"model": LivenessErrorResponse},
            422: {"model": LivenessErrorResponse},
            500: {"model": LivenessErrorResponse},
        },
    )
    def liveness_visual(request: InferenceRequest) -> LivenessResponse:
        _record_model_version("/v1/liveness/visual")
        started = time.perf_counter()
        try:
            if isinstance(resolved_liveness_detector, ProductionLivenessDetector):
                result = resolved_liveness_detector.detect_with_metadata(request.decoded_payload())
                if observability_logger is not None and model_versions is not None:
                    labels = {
                        **model_versions.label_set("/v1/liveness/visual"),
                        "sessionId": request.session_id,
                    }
                    log_ai_metric(
                        observability_logger,
                        metric_name=METRIC_CONFIDENCE_DISTRIBUTION,
                        metric_type="counter",
                        value=1,
                        labels={
                            **labels,
                            "bucket": confidence_bucket(result.liveness_score),
                            "confidenceKind": "liveness",
                        },
                    )
                    log_ai_metric(
                        observability_logger,
                        metric_name=METRIC_SPOOF_DETECTION_RATE,
                        metric_type="counter",
                        value=0 if result.is_live else 1,
                        labels={**labels, "signal": "visual_liveness"},
                    )
                return LivenessResponse(
                    session_id=request.session_id,
                    score=result.score,
                    is_live=result.is_live,
                    liveness_score=result.liveness_score,
                    spoof_probability=result.spoof_probability,
                    confidence=result.confidence,
                    inference_latency=result.inference_latency_ms,
                )

            result = resolved_liveness_detector.detect(request.decoded_payload())
            return LivenessResponse(
                session_id=request.session_id,
                score=result.score,
                is_live=result.is_live,
                liveness_score=result.score,
                spoof_probability=max(0.0, 1.0 - result.score),
                confidence=1.0,
                inference_latency=0.0,
            )
        except LivenessDetectionError as exc:
            raise HTTPException(
                status_code=_liveness_error_status(exc.code),
                detail={
                    "error": exc.code.value,
                    "sessionId": request.session_id,
                    "message": exc.message,
                },
            ) from exc
        finally:
            _record_inference_latency("/v1/liveness/visual", (time.perf_counter() - started) * 1000.0)

    return app
