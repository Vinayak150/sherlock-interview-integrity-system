"""Liveness/anti-spoof scoring. Same stub-vs-real seam as
`embeddings/extractor.py` -- `StubLivenessDetector` is a deterministic
placeholder, not a real anti-spoof model, kept honest and clearly labeled
per this codebase's established convention.
"""

from __future__ import annotations

import hashlib
from typing import NamedTuple, Protocol


class LivenessResult(NamedTuple):
    score: float  # in [0, 1]; higher means more likely a live, genuine capture.
    is_live: bool


LIVENESS_THRESHOLD = 0.5


class LivenessDetector(Protocol):
    def detect(self, payload: bytes) -> LivenessResult: ...


class StubLivenessDetector:
    def detect(self, payload: bytes) -> LivenessResult:
        if len(payload) == 0:
            raise ValueError("payload must not be empty")

        digest = hashlib.sha256(payload).digest()
        score = int.from_bytes(digest[:4], byteorder="big") / (2**32 - 1)
        return LivenessResult(score=score, is_live=score >= LIVENESS_THRESHOLD)
