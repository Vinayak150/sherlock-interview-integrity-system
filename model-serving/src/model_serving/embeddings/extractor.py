"""Face/voice embedding extraction (RFC §4-C/D: "face-embedding
self-consistency," "voice-embedding self-consistency" -- "strong,
reference-independent" signals).

`Protocol`-typed so a real model backend can be substituted later without
touching the serving API layer that calls it -- the same seam
`AtsClient`/`InMemoryAtsClient` (orchestrator M2) and every persistence
port in this codebase already use.

`StubEmbeddingExtractor` is a deterministic, seeded-hash placeholder for
voice embeddings and tests -- **not a biometric model**.

`InsightFaceEmbeddingExtractor` is the production face backend (buffalo_l
via onnxruntime). It is loaded once at application startup in `main.py`.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Protocol

# InsightFace buffalo_l produces 512-dimensional embeddings.
EMBEDDING_DIMENSION = 512


class NoFaceDetectedError(Exception):
    """Raised when a frame decodes successfully but contains no detectable face."""


@dataclass(frozen=True)
class FaceExtractionResult:
    """Internal face-extraction output including detector confidence."""

    embedding: list[float]
    detection_confidence: float


class EmbeddingExtractor(Protocol):
    def extract(self, payload: bytes) -> list[float]:
        """Returns an embedding vector for `payload`."""
        ...


class StubEmbeddingExtractor:
    """Deterministic placeholder for voice embeddings and unit tests."""

    def extract(self, payload: bytes) -> list[float]:
        if len(payload) == 0:
            raise ValueError("payload must not be empty")

        vector: list[float] = []
        block = payload
        while len(vector) < EMBEDDING_DIMENSION:
            block = hashlib.sha512(block).digest()
            for i in range(0, len(block), 8):
                if len(vector) >= EMBEDDING_DIMENSION:
                    break
                chunk = block[i : i + 8].ljust(8, b"\x00")
                raw = int.from_bytes(chunk, byteorder="big", signed=False)
                vector.append((raw / (2**64 - 1)) * 2 - 1)

        return vector[:EMBEDDING_DIMENSION]
