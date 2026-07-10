"""Face/voice embedding extraction (RFC §4-C/D: "face-embedding
self-consistency," "voice-embedding self-consistency" -- "strong,
reference-independent" signals).

`Protocol`-typed so a real model backend can be substituted later without
touching the serving API layer that calls it -- the same seam
`AtsClient`/`InMemoryAtsClient` (orchestrator M2) and every persistence
port in this codebase already use.

`StubEmbeddingExtractor` is a deterministic, seeded-hash placeholder --
**not a biometric model**. It exists so the RPC contract (request/response
shape, dimensionality, latency characteristics) is real and testable end
to end before any actual embedding model is trained or licensed, mirroring
this codebase's established pattern of building the real *contract* first
and marking the placeholder honestly (`InMemoryAtsClient`, M2;
`InMemorySessionRegistry`, M7). It must never be mistaken for, or shipped
as, a genuine identity signal.
"""

from __future__ import annotations

import hashlib
from typing import Protocol

EMBEDDING_DIMENSION = 128


class EmbeddingExtractor(Protocol):
    def extract(self, payload: bytes) -> list[float]:
        """Returns an `EMBEDDING_DIMENSION`-length embedding vector for `payload`."""
        ...


class StubEmbeddingExtractor:
    """Deterministic placeholder: derives a fixed-length vector from a
    SHA-512-based expansion of the input bytes. Deterministic (the same
    input always yields the same vector, letting self-consistency
    comparisons behave sensibly in tests) but carries zero real biometric
    information -- see module docstring.
    """

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
                # Map into [-1, 1] -- a plausible normalized-embedding-component range.
                vector.append((raw / (2**64 - 1)) * 2 - 1)

        return vector[:EMBEDDING_DIMENSION]
