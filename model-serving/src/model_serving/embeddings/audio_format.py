"""WAV validation and decoding for the speaker pipeline."""

from __future__ import annotations

import io
import wave
from dataclasses import dataclass

import numpy as np

from model_serving.embeddings.voice_errors import VoiceExtractionError, VoiceExtractionErrorCode

REQUIRED_SAMPLE_RATE = 16_000
REQUIRED_CHANNELS = 1
MIN_DURATION_SECONDS = 0.2


@dataclass(frozen=True)
class DecodedAudio:
    samples: np.ndarray
    sample_rate: int
    duration_seconds: float


def decode_wav_mono_16k(payload: bytes) -> DecodedAudio:
    if len(payload) < 12:
        raise VoiceExtractionError(
            VoiceExtractionErrorCode.CORRUPTED_AUDIO,
            "audio payload is too short to be a valid WAV file",
        )

    if payload[:4] != b"RIFF" or payload[8:12] != b"WAVE":
        raise VoiceExtractionError(
            VoiceExtractionErrorCode.INVALID_AUDIO_FORMAT,
            "payload must be a WAV file (RIFF/WAVE header missing)",
        )

    try:
        with wave.open(io.BytesIO(payload), "rb") as wav_file:
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            sample_rate = wav_file.getframerate()
            frame_count = wav_file.getnframes()
            raw_frames = wav_file.readframes(frame_count)
    except wave.Error as exc:
        raise VoiceExtractionError(
            VoiceExtractionErrorCode.CORRUPTED_AUDIO,
            f"failed to decode WAV payload: {exc}",
        ) from exc

    if channels != REQUIRED_CHANNELS:
        raise VoiceExtractionError(
            VoiceExtractionErrorCode.UNSUPPORTED_CHANNELS,
            f"expected mono audio ({REQUIRED_CHANNELS} channel), received {channels}",
        )

    if sample_rate != REQUIRED_SAMPLE_RATE:
        raise VoiceExtractionError(
            VoiceExtractionErrorCode.UNSUPPORTED_SAMPLE_RATE,
            f"expected {REQUIRED_SAMPLE_RATE}Hz audio, received {sample_rate}Hz",
        )

    if sample_width not in {2, 4}:
        raise VoiceExtractionError(
            VoiceExtractionErrorCode.INVALID_AUDIO_FORMAT,
            f"unsupported sample width: {sample_width} bytes",
        )

    if frame_count == 0 or len(raw_frames) == 0:
        raise VoiceExtractionError(
            VoiceExtractionErrorCode.CORRUPTED_AUDIO,
            "WAV payload contains no audio frames",
        )

    dtype = np.int16 if sample_width == 2 else np.int32
    samples = np.frombuffer(raw_frames, dtype=dtype).astype(np.float32)
    max_value = float(np.iinfo(dtype).max)
    samples /= max_value

    duration_seconds = frame_count / sample_rate
    return DecodedAudio(samples=samples, sample_rate=sample_rate, duration_seconds=duration_seconds)
