from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from model_serving.embeddings.extractor import EMBEDDING_DIMENSION, NoFaceDetectedError
from model_serving.embeddings.insightface_extractor import InsightFaceEmbeddingExtractor


class TestInsightFaceEmbeddingExtractor:
    def test_load_initializes_analyzer_once(self) -> None:
        extractor = InsightFaceEmbeddingExtractor()
        with patch("model_serving.embeddings.insightface_extractor.FaceAnalysis") as face_analysis:
            analyzer = MagicMock()
            face_analysis.return_value = analyzer
            extractor.load()
            extractor.load()
            face_analysis.assert_called_once()
            analyzer.prepare.assert_called_once()

    def test_extract_returns_normalized_embedding_for_largest_face(self) -> None:
        extractor = InsightFaceEmbeddingExtractor()
        small_face = SimpleNamespace(
            bbox=np.array([0.0, 0.0, 10.0, 10.0]),
            det_score=0.7,
            embedding=np.ones(EMBEDDING_DIMENSION, dtype=np.float32),
        )
        large_face = SimpleNamespace(
            bbox=np.array([0.0, 0.0, 100.0, 100.0]),
            det_score=0.95,
            embedding=np.arange(EMBEDDING_DIMENSION, dtype=np.float32),
        )
        analyzer = MagicMock()
        analyzer.get.return_value = [small_face, large_face]
        extractor._analyzer = analyzer

        with patch("model_serving.embeddings.insightface_extractor.cv2.imdecode") as imdecode:
            imdecode.return_value = np.zeros((32, 32, 3), dtype=np.uint8)
            result = extractor.extract_with_metadata(b"fake-image")

        assert len(result.embedding) == EMBEDDING_DIMENSION
        norm = sum(value * value for value in result.embedding) ** 0.5
        assert norm == pytest.approx(1.0, rel=1e-5)
        assert result.detection_confidence == pytest.approx(0.95)

    def test_extract_raises_no_face_when_detector_returns_empty(self) -> None:
        extractor = InsightFaceEmbeddingExtractor()
        analyzer = MagicMock()
        analyzer.get.return_value = []
        extractor._analyzer = analyzer

        with patch("model_serving.embeddings.insightface_extractor.cv2.imdecode") as imdecode:
            imdecode.return_value = np.zeros((32, 32, 3), dtype=np.uint8)
            with pytest.raises(NoFaceDetectedError):
                extractor.extract(b"fake-image")

    def test_extract_raises_before_load(self) -> None:
        extractor = InsightFaceEmbeddingExtractor()
        with pytest.raises(RuntimeError):
            extractor.extract(b"fake-image")
