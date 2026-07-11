"""Embedding extraction (RFC §9.2/§9.6)."""

from model_serving.embeddings.extractor import (
    EMBEDDING_DIMENSION,
    EmbeddingExtractor,
    FaceExtractionResult,
    NoFaceDetectedError,
    StubEmbeddingExtractor,
)
from model_serving.embeddings.insightface_extractor import InsightFaceEmbeddingExtractor

__all__ = [
    "EMBEDDING_DIMENSION",
    "EmbeddingExtractor",
    "FaceExtractionResult",
    "InsightFaceEmbeddingExtractor",
    "NoFaceDetectedError",
    "StubEmbeddingExtractor",
]
