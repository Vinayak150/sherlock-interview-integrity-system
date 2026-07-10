"""Embedding extraction (RFC §9.2/§9.6: "embedding extraction ... GPU-bound,
batch-friendly"). See `extractor.py` for the extractor abstraction and the
stub implementation actually wired into the serving API today.
"""

from model_serving.embeddings.extractor import EmbeddingExtractor, StubEmbeddingExtractor

__all__ = ["EmbeddingExtractor", "StubEmbeddingExtractor"]
