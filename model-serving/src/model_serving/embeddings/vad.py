"""Lightweight speech-activity detection for CPU inference."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from model_serving.embeddings.voice_errors import VoiceExtractionError, VoiceExtractionErrorCode

FRAME_MS = 30
MIN_SPEECH_SECONDS = 0.3
ENERGY_FLOOR = 0.01
NOISE_SNR_THRESHOLD_DB = 8.0


@dataclass(frozen=True)
class SpeechActivity:
    speech_samples: np.ndarray
    speech_duration: float
    total_duration: float
    speech_ratio: float
    snr_db: float


def _frame_rms(frame: np.ndarray) -> float:
    if frame.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(frame * frame)))


def detect_speech_activity(samples: np.ndarray, sample_rate: int) -> SpeechActivity:
    if samples.size == 0:
        raise VoiceExtractionError(
            VoiceExtractionErrorCode.NO_SPEECH_DETECTED,
            "audio clip contains no samples",
        )

    frame_size = max(1, int(sample_rate * FRAME_MS / 1000))
    frame_energies: list[float] = []
    for start in range(0, samples.size, frame_size):
        frame = samples[start : start + frame_size]
        frame_energies.append(_frame_rms(frame))

    if not frame_energies:
        raise VoiceExtractionError(
            VoiceExtractionErrorCode.NO_SPEECH_DETECTED,
            "unable to segment audio for speech detection",
        )

    noise_floor = float(np.percentile(frame_energies, 10))
    peak_energy = float(np.max(frame_energies))
    threshold = max(ENERGY_FLOOR, peak_energy * 0.15)
    speech_mask = np.array([energy >= threshold for energy in frame_energies], dtype=bool)

    speech_samples_list: list[np.ndarray] = []
    for index, is_speech in enumerate(speech_mask):
        if not is_speech:
            continue
        start = index * frame_size
        end = min(samples.size, start + frame_size)
        speech_samples_list.append(samples[start:end])

    if not speech_samples_list:
        raise VoiceExtractionError(
            VoiceExtractionErrorCode.NO_SPEECH_DETECTED,
            "no speech activity detected in audio clip",
        )

    speech_samples = np.concatenate(speech_samples_list)
    total_duration = samples.size / sample_rate
    speech_duration = speech_samples.size / sample_rate
    speech_ratio = speech_duration / total_duration if total_duration > 0 else 0.0

    if speech_duration < MIN_SPEECH_SECONDS:
        raise VoiceExtractionError(
            VoiceExtractionErrorCode.CLIP_TOO_SHORT,
            f"detected speech duration {speech_duration:.3f}s is below minimum {MIN_SPEECH_SECONDS}s",
        )

    speech_energy = _frame_rms(speech_samples)
    non_speech_energies = [
        energy for energy, is_speech in zip(frame_energies, speech_mask, strict=True) if not is_speech
    ]
    if non_speech_energies:
        noise_reference = float(np.median(non_speech_energies))
        snr_db = 20.0 * np.log10(max(speech_energy, 1e-8) / max(noise_reference, 1e-8))
        if snr_db < NOISE_SNR_THRESHOLD_DB:
            raise VoiceExtractionError(
                VoiceExtractionErrorCode.NOISY_AUDIO,
                f"audio signal-to-noise ratio {snr_db:.1f}dB is below threshold",
            )
    else:
        snr_db = 30.0

    return SpeechActivity(
        speech_samples=speech_samples,
        speech_duration=speech_duration,
        total_duration=total_duration,
        speech_ratio=speech_ratio,
        snr_db=float(snr_db),
    )
