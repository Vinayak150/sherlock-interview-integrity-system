from __future__ import annotations

import pytest

from model_serving.embeddings.extractor import EMBEDDING_DIMENSION, StubEmbeddingExtractor


class TestStubEmbeddingExtractor:
    def test_returns_the_configured_dimension(self) -> None:
        extractor = StubEmbeddingExtractor()
        embedding = extractor.extract(b"some frame bytes")
        assert len(embedding) == EMBEDDING_DIMENSION

    def test_every_component_is_within_the_normalized_range(self) -> None:
        extractor = StubEmbeddingExtractor()
        embedding = extractor.extract(b"some frame bytes")
        assert all(-1.0 <= component <= 1.0 for component in embedding)

    def test_is_deterministic_for_the_same_input(self) -> None:
        extractor = StubEmbeddingExtractor()
        first = extractor.extract(b"identical payload")
        second = extractor.extract(b"identical payload")
        assert first == second

    def test_differs_for_different_inputs(self) -> None:
        extractor = StubEmbeddingExtractor()
        first = extractor.extract(b"payload one")
        second = extractor.extract(b"payload two")
        assert first != second

    def test_rejects_an_empty_payload(self) -> None:
        extractor = StubEmbeddingExtractor()
        with pytest.raises(ValueError):
            extractor.extract(b"")

    def test_handles_a_very_short_payload(self) -> None:
        extractor = StubEmbeddingExtractor()
        embedding = extractor.extract(b"x")
        assert len(embedding) == EMBEDDING_DIMENSION
