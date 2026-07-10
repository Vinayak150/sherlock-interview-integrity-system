from __future__ import annotations

import base64

from fastapi.testclient import TestClient

from model_serving.embeddings.extractor import EMBEDDING_DIMENSION
from model_serving.liveness.detector import LIVENESS_THRESHOLD
from model_serving.serving_api.app import create_app


def encoded(payload: bytes) -> str:
    return base64.b64encode(payload).decode("ascii")


class TestHealth:
    def test_returns_ok(self) -> None:
        client = TestClient(create_app())
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


class TestEmbeddingsFace:
    def test_returns_an_embedding_of_the_expected_dimension(self) -> None:
        client = TestClient(create_app())
        response = client.post(
            "/v1/embeddings/face",
            json={"sessionId": "session-1", "payload": encoded(b"frame-bytes")},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["sessionId"] == "session-1"
        assert body["dimension"] == EMBEDDING_DIMENSION
        assert len(body["embedding"]) == EMBEDDING_DIMENSION

    def test_is_deterministic_across_requests_for_identical_payloads(self) -> None:
        client = TestClient(create_app())
        request_body = {"sessionId": "session-1", "payload": encoded(b"frame-bytes")}

        first = client.post("/v1/embeddings/face", json=request_body).json()
        second = client.post("/v1/embeddings/face", json=request_body).json()

        assert first["embedding"] == second["embedding"]

    def test_rejects_a_missing_sessionId(self) -> None:
        client = TestClient(create_app())
        response = client.post("/v1/embeddings/face", json={"payload": encoded(b"frame")})
        assert response.status_code == 422

    def test_rejects_invalid_base64_payload(self) -> None:
        client = TestClient(create_app())
        response = client.post(
            "/v1/embeddings/face", json={"sessionId": "session-1", "payload": "not-valid-base64!!"}
        )
        assert response.status_code == 422

    def test_rejects_an_empty_decoded_payload(self) -> None:
        client = TestClient(create_app())
        response = client.post(
            "/v1/embeddings/face", json={"sessionId": "session-1", "payload": encoded(b"")}
        )
        assert response.status_code == 422


class TestEmbeddingsVoice:
    def test_returns_an_embedding(self) -> None:
        client = TestClient(create_app())
        response = client.post(
            "/v1/embeddings/voice",
            json={"sessionId": "session-1", "payload": encoded(b"audio-chunk-bytes")},
        )
        assert response.status_code == 200
        assert response.json()["dimension"] == EMBEDDING_DIMENSION

    def test_face_and_voice_extractors_are_independent_instances(self) -> None:
        # Same raw payload, two different endpoints -- should still both succeed and be
        # internally deterministic even though they are separately constructed extractors.
        client = TestClient(create_app())
        payload = encoded(b"shared-bytes")
        face = client.post(
            "/v1/embeddings/face", json={"sessionId": "session-1", "payload": payload}
        ).json()
        voice = client.post(
            "/v1/embeddings/voice", json={"sessionId": "session-1", "payload": payload}
        ).json()
        assert face["embedding"] == voice["embedding"]  # same stub algorithm, same input


class TestLivenessVisual:
    def test_returns_a_score_and_boolean_consistent_with_the_threshold(self) -> None:
        client = TestClient(create_app())
        response = client.post(
            "/v1/liveness/visual",
            json={"sessionId": "session-1", "payload": encoded(b"frame-bytes")},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["sessionId"] == "session-1"
        assert body["isLive"] == (body["score"] >= LIVENESS_THRESHOLD)


class TestInjectedImplementations:
    def test_create_app_accepts_custom_extractors_and_detector(self) -> None:
        class FixedEmbeddingExtractor:
            def extract(self, payload: bytes) -> list[float]:
                return [0.5] * EMBEDDING_DIMENSION

        class FixedLivenessDetector:
            def detect(self, payload: bytes):  # type: ignore[no-untyped-def]
                from model_serving.liveness.detector import LivenessResult

                return LivenessResult(score=0.99, is_live=True)

        client = TestClient(
            create_app(
                face_extractor=FixedEmbeddingExtractor(),
                voice_extractor=FixedEmbeddingExtractor(),
                liveness_detector=FixedLivenessDetector(),
            )
        )

        face_response = client.post(
            "/v1/embeddings/face", json={"sessionId": "session-1", "payload": encoded(b"anything")}
        )
        assert face_response.json()["embedding"] == [0.5] * EMBEDDING_DIMENSION

        liveness_response = client.post(
            "/v1/liveness/visual", json={"sessionId": "session-1", "payload": encoded(b"anything")}
        )
        assert liveness_response.json() == {"sessionId": "session-1", "score": 0.99, "isLive": True}
