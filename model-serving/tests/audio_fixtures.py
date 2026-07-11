from __future__ import annotations

import io
import math
import wave

import numpy as np


def make_wav_bytes(
    *,
    sample_rate: int = 16_000,
    duration_seconds: float = 1.0,
    frequency_hz: float = 220.0,
    amplitude: float = 0.25,
    channels: int = 1,
    silence: bool = False,
    noise_amplitude: float = 0.0,
    speaker_seed: int = 0,
) -> bytes:
    sample_count = max(1, int(sample_rate * duration_seconds))
    timeline = np.arange(sample_count, dtype=np.float32) / sample_rate
    if silence:
        samples = np.zeros(sample_count, dtype=np.float32)
    else:
        phase = speaker_seed * 0.17
        samples = amplitude * np.sin(2.0 * math.pi * frequency_hz * timeline + phase).astype(np.float32)
        if noise_amplitude > 0:
            rng = np.random.default_rng(speaker_seed)
            samples += noise_amplitude * rng.standard_normal(sample_count).astype(np.float32)

    clipped = np.clip(samples, -1.0, 1.0)
    int16 = (clipped * 32767.0).astype(np.int16)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(int16.tobytes())
    return buffer.getvalue()
