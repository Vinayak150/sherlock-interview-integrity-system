"""Structured voice-extraction error codes."""

from __future__ import annotations

from enum import StrEnum


class VoiceExtractionErrorCode(StrEnum):
    INVALID_AUDIO_FORMAT = "INVALID_AUDIO_FORMAT"
    UNSUPPORTED_SAMPLE_RATE = "UNSUPPORTED_SAMPLE_RATE"
    UNSUPPORTED_CHANNELS = "UNSUPPORTED_CHANNELS"
    CORRUPTED_AUDIO = "CORRUPTED_AUDIO"
    NO_SPEECH_DETECTED = "NO_SPEECH_DETECTED"
    CLIP_TOO_SHORT = "CLIP_TOO_SHORT"
    OVERLAPPING_SPEAKERS = "OVERLAPPING_SPEAKERS"
    NOISY_AUDIO = "NOISY_AUDIO"
    EXTRACTION_FAILED = "EXTRACTION_FAILED"


class VoiceExtractionError(Exception):
    """Raised when speaker embedding extraction cannot proceed."""

    def __init__(self, code: VoiceExtractionErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
