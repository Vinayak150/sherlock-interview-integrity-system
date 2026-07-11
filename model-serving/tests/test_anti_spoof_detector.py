from __future__ import annotations

import base64
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from fastapi.testclient import TestClient

from model_serving.liveness.anti_spoof_detector import (
    DeterministicTestAntiSpoofBackend,
    ProductionLivenessDetector,
    SpoofCategory,
)
from model_serving.liveness.liveness_errors import LivenessDetectionError, LivenessDetectionErrorCode
from model_serving.serving_api.app import create_app
from tests.frame_fixtures import (
    make_live_frame,
    make_no_face_frame,
    make_printed_spoof_frame,
    make_replay_frame,
)


def encoded(payload: bytes) -> str:
    return base64.b64encode(payload).decode("ascii")


def _face(score: float = 0.95) -> SimpleNamespace:
    return SimpleNamespace(bbox=np.array([40.0, 30.0, 120.0, 130.0]), det_score=score)


@pytest.fixture
def detector() -> ProductionLivenessDetector:
    backend = DeterministicTestAntiSpoofBackend()
    backend.load()
    liveness_detector = ProductionLivenessDetector(backend=backend)
    analyzer = MagicMock()
    analyzer.get.return_value = [_face()]
    liveness_detector._analyzer = analyzer  # noqa: SLF001 -- test seam
    liveness_detector._loaded = True  # noqa: SLF001
    return liveness_detector


class TestProductionLivenessDetector:
    def test_live_face_scores_high_liveness(self, detector: ProductionLivenessDetector) -> None:
        result = detector.detect_with_metadata(make_live_frame())
        assert result.is_live is True
        assert result.liveness_score > 0.8
        assert result.spoof_probability < 0.2
        assert result.confidence > 0.5
        assert result.spoof_category == SpoofCategory.LIVE

    def test_spoof_image_scores_low_liveness(self, detector: ProductionLivenessDetector) -> None:
        result = detector.detect_with_metadata(make_printed_spoof_frame())
        assert result.is_live is False
        assert result.spoof_category == SpoofCategory.PRINTED_PHOTO
        assert result.spoof_probability > 0.5

    def test_replay_attack_is_detected(self, detector: ProductionLivenessDetector) -> None:
        result = detector.detect_with_metadata(make_replay_frame())
        assert result.is_live is False
        assert result.spoof_category in {
            SpoofCategory.SCREEN_REPLAY,
            SpoofCategory.PHONE_REPLAY,
        }
        assert result.spoof_probability > 0.5

    def test_no_face_is_rejected(self, detector: ProductionLivenessDetector) -> None:
        detector._analyzer.get.return_value = []  # type: ignore[union-attr]
        with pytest.raises(LivenessDetectionError) as exc_info:
            detector.detect_with_metadata(make_no_face_frame())
        assert exc_info.value.code == LivenessDetectionErrorCode.NO_FACE_DETECTED

    def test_multiple_faces_are_rejected(self, detector: ProductionLivenessDetector) -> None:
        detector._analyzer.get.return_value = [_face(), _face(0.8)]  # type: ignore[union-attr]
        with pytest.raises(LivenessDetectionError) as exc_info:
            detector.detect_with_metadata(make_live_frame())
        assert exc_info.value.code == LivenessDetectionErrorCode.MULTIPLE_FACES

    def test_corrupted_frame_is_rejected(self, detector: ProductionLivenessDetector) -> None:
        with pytest.raises(LivenessDetectionError) as exc_info:
            detector.detect_with_metadata(b"not-a-valid-image-header")
        assert exc_info.value.code == LivenessDetectionErrorCode.UNSUPPORTED_IMAGE_FORMAT

    def test_model_is_not_reloaded_per_request(self, detector: ProductionLivenessDetector) -> None:
        backend_name = detector.backend_name
        detector.detect(make_live_frame())
        detector.detect(make_live_frame())
        assert detector.backend_name == backend_name


class TestLivenessServingApi:
    def _client(self) -> TestClient:
        backend = DeterministicTestAntiSpoofBackend()
        backend.load()
        liveness_detector = ProductionLivenessDetector(backend=backend)
        analyzer = MagicMock()
        analyzer.get.return_value = [_face()]
        liveness_detector._analyzer = analyzer  # noqa: SLF001
        liveness_detector._loaded = True  # noqa: SLF001
        return TestClient(create_app(liveness_detector=liveness_detector))

    def test_returns_backward_compatible_fields(self) -> None:
        client = self._client()
        response = client.post(
            "/v1/liveness/visual",
            json={"sessionId": "session-1", "payload": encoded(make_live_frame())},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["sessionId"] == "session-1"
        assert body["score"] == body["livenessScore"]
        assert "spoofProbability" in body
        assert "confidence" in body
        assert "inferenceLatency" in body
        assert isinstance(body["isLive"], bool)

    def test_returns_structured_error_for_no_face(self) -> None:
        client = self._client()
        with patch.object(ProductionLivenessDetector, "detect_with_metadata") as detect:
            detect.side_effect = LivenessDetectionError(
                LivenessDetectionErrorCode.NO_FACE_DETECTED,
                "no face detected in frame",
            )
            response = client.post(
                "/v1/liveness/visual",
                json={"sessionId": "session-1", "payload": encoded(make_live_frame())},
            )
        assert response.status_code == 404
        assert response.json()["detail"]["error"] == LivenessDetectionErrorCode.NO_FACE_DETECTED

    def test_returns_structured_error_for_corrupted_frame(self) -> None:
        client = self._client()
        response = client.post(
            "/v1/liveness/visual",
            json={"sessionId": "session-1", "payload": encoded(b"invalid-image-header-bytes")},
        )
        assert response.status_code == 422
        assert response.json()["detail"]["error"] in {
            LivenessDetectionErrorCode.UNSUPPORTED_IMAGE_FORMAT,
            LivenessDetectionErrorCode.CORRUPTED_FRAME,
        }
