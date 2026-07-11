"""Structured liveness-detection error codes."""

from __future__ import annotations

from enum import StrEnum


class LivenessDetectionErrorCode(StrEnum):
    NO_FACE_DETECTED = "NO_FACE_DETECTED"
    MULTIPLE_FACES = "MULTIPLE_FACES"
    LOW_RESOLUTION = "LOW_RESOLUTION"
    CORRUPTED_FRAME = "CORRUPTED_FRAME"
    UNSUPPORTED_IMAGE_FORMAT = "UNSUPPORTED_IMAGE_FORMAT"
    DETECTION_FAILED = "DETECTION_FAILED"


class LivenessDetectionError(Exception):
    """Raised when visual liveness detection cannot proceed."""

    def __init__(self, code: LivenessDetectionErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
