from __future__ import annotations

import pytest

from model_serving.liveness.detector import LIVENESS_THRESHOLD, StubLivenessDetector


class TestStubLivenessDetector:
    def test_returns_a_score_within_unit_interval(self) -> None:
        detector = StubLivenessDetector()
        result = detector.detect(b"a frame")
        assert 0.0 <= result.score <= 1.0

    def test_is_live_matches_the_threshold(self) -> None:
        detector = StubLivenessDetector()
        result = detector.detect(b"a frame")
        assert result.is_live == (result.score >= LIVENESS_THRESHOLD)

    def test_is_deterministic_for_the_same_input(self) -> None:
        detector = StubLivenessDetector()
        first = detector.detect(b"identical payload")
        second = detector.detect(b"identical payload")
        assert first == second

    def test_rejects_an_empty_payload(self) -> None:
        detector = StubLivenessDetector()
        with pytest.raises(ValueError):
            detector.detect(b"")
