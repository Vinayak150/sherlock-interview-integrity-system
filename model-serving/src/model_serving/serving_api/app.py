"""The Model-Serving Layer's HTTP surface (Plan M8). Deliberately thin --
every route parses/validates the request, calls into the
extractor/detector it was constructed with, and serializes the response.
No inference logic lives here; `embeddings/extractor.py` and
`liveness/detector.py` own that, matching the orchestrator API layer's own
"thin ingress, no duplicated logic" convention (Plan M8, orchestrator
side).

Endpoints are namespaced by signal family (`/v1/embeddings/face`,
`/v1/embeddings/voice`, `/v1/liveness/visual`) rather than by a single
generic `/v1/infer`, since the RFC treats face/voice embeddings and
liveness as distinct signal families (§4-C/D) with distinct downstream
consumers (Visual vs. Audio Bundle Adapters, M9) -- the route names should
say what they are, not hide behind one polymorphic endpoint.
"""

from __future__ import annotations

from fastapi import FastAPI

from model_serving.embeddings.extractor import EmbeddingExtractor, StubEmbeddingExtractor
from model_serving.liveness.detector import LivenessDetector, StubLivenessDetector
from model_serving.serving_api.schemas import (
    EmbeddingResponse,
    HealthResponse,
    InferenceRequest,
    LivenessResponse,
)


def create_app(
    face_extractor: EmbeddingExtractor | None = None,
    voice_extractor: EmbeddingExtractor | None = None,
    liveness_detector: LivenessDetector | None = None,
) -> FastAPI:
    """Builds the FastAPI app. Extractors/detector are injectable
    (defaulting to the stub implementations) so tests -- and, later, a
    real-model deployment -- can substitute them without touching route
    wiring.
    """
    resolved_face_extractor = face_extractor or StubEmbeddingExtractor()
    resolved_voice_extractor = voice_extractor or StubEmbeddingExtractor()
    resolved_liveness_detector = liveness_detector or StubLivenessDetector()

    app = FastAPI(title="Sherlock Model-Serving Layer")

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok")

    @app.post("/v1/embeddings/face", response_model=EmbeddingResponse)
    def embed_face(request: InferenceRequest) -> EmbeddingResponse:
        embedding = resolved_face_extractor.extract(request.decoded_payload())
        return EmbeddingResponse(
            session_id=request.session_id, embedding=embedding, dimension=len(embedding)
        )

    @app.post("/v1/embeddings/voice", response_model=EmbeddingResponse)
    def embed_voice(request: InferenceRequest) -> EmbeddingResponse:
        embedding = resolved_voice_extractor.extract(request.decoded_payload())
        return EmbeddingResponse(
            session_id=request.session_id, embedding=embedding, dimension=len(embedding)
        )

    @app.post("/v1/liveness/visual", response_model=LivenessResponse)
    def liveness_visual(request: InferenceRequest) -> LivenessResponse:
        result = resolved_liveness_detector.detect(request.decoded_payload())
        return LivenessResponse(
            session_id=request.session_id, score=result.score, is_live=result.is_live
        )

    return app
