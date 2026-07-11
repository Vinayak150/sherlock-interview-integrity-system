from __future__ import annotations

import base64
from unittest.mock import patch

import numpy as np
import pytest
from fastapi.testclient import TestClient

from model_serving.embeddings.speaker_extractor import (
    DeterministicTestSpeakerBackend,
    SpeakerEmbeddingExtractor,
    _cosine_similarity,
)
from model_serving.embeddings.voice_errors import VoiceExtractionError, VoiceExtractionErrorCode
from model_serving.serving_api.app import create_app
from tests.audio_fixtures import make_wav_bytes


def encoded(payload: bytes) -> str:
    return base64.b64encode(payload).decode("ascii")


@pytest.fixture
def extractor() -> SpeakerEmbeddingExtractor:
    backend = DeterministicTestSpeakerBackend()
    backend.load()
    speaker_extractor = SpeakerEmbeddingExtractor(backend=backend)
    speaker_extractor.load()
    return speaker_extractor


class TestSpeakerEmbeddingExtractor:
    def test_same_speaker_produces_high_cosine_similarity(self, extractor: SpeakerEmbeddingExtractor) -> None:
        wav = make_wav_bytes(speaker_seed=7)
        first = np.asarray(extractor.extract(wav), dtype=np.float64)
        second = np.asarray(extractor.extract(wav), dtype=np.float64)
        assert _cosine_similarity(first, second) > 0.999

    def test_different_speakers_produce_lower_similarity(self, extractor: SpeakerEmbeddingExtractor) -> None:
        first = np.asarray(extractor.extract(make_wav_bytes(speaker_seed=1, frequency_hz=180.0)), dtype=np.float64)
        second = np.asarray(
            extractor.extract(make_wav_bytes(speaker_seed=99, frequency_hz=420.0)),
            dtype=np.float64,
        )
        assert _cosine_similarity(first, second) < 0.95

    def test_silence_is_rejected(self, extractor: SpeakerEmbeddingExtractor) -> None:
        with pytest.raises(VoiceExtractionError) as exc_info:
            extractor.extract(make_wav_bytes(silence=True, duration_seconds=1.0))
        assert exc_info.value.code == VoiceExtractionErrorCode.NO_SPEECH_DETECTED

    def test_short_clip_is_rejected(self, extractor: SpeakerEmbeddingExtractor) -> None:
        with pytest.raises(VoiceExtractionError) as exc_info:
            extractor.extract(make_wav_bytes(duration_seconds=0.25, amplitude=0.4))
        assert exc_info.value.code == VoiceExtractionErrorCode.CLIP_TOO_SHORT

    def test_noisy_audio_is_rejected(self, extractor: SpeakerEmbeddingExtractor) -> None:
        with patch(
            "model_serving.embeddings.speaker_extractor.detect_speech_activity",
            side_effect=VoiceExtractionError(
                VoiceExtractionErrorCode.NOISY_AUDIO,
                "audio signal-to-noise ratio is below threshold",
            ),
        ):
            with pytest.raises(VoiceExtractionError) as exc_info:
                extractor.extract(make_wav_bytes(speaker_seed=3))
        assert exc_info.value.code == VoiceExtractionErrorCode.NOISY_AUDIO

    def test_corrupted_audio_is_rejected(self, extractor: SpeakerEmbeddingExtractor) -> None:
        with pytest.raises(VoiceExtractionError) as exc_info:
            extractor.extract(b"this-is-not-a-valid-wav-header-at-all")
        assert exc_info.value.code == VoiceExtractionErrorCode.INVALID_AUDIO_FORMAT

    def test_overlapping_speakers_are_rejected(self, extractor: SpeakerEmbeddingExtractor) -> None:
        sample_rate = 16_000
        duration_seconds = 1.2
        sample_count = int(sample_rate * duration_seconds)
        timeline = np.arange(sample_count, dtype=np.float32) / sample_rate
        first_half = 0.25 * np.sin(2 * np.pi * 120 * timeline[: sample_count // 2])
        second_half = 0.25 * np.sin(2 * np.pi * 2000 * timeline[sample_count // 2 :])
        samples = np.concatenate([first_half, second_half]).astype(np.float32)
        int16 = (np.clip(samples, -1.0, 1.0) * 32767.0).astype(np.int16)

        import io
        import wave

        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(int16.tobytes())

        with pytest.raises(VoiceExtractionError) as exc_info:
            extractor.extract(buffer.getvalue())
        assert exc_info.value.code == VoiceExtractionErrorCode.OVERLAPPING_SPEAKERS

    def test_returns_normalized_embedding_metadata(self, extractor: SpeakerEmbeddingExtractor) -> None:
        result = extractor.extract_with_metadata(make_wav_bytes(speaker_seed=5))
        assert result.embedding_dimension == len(result.embedding)
        assert all(-1.0 <= component <= 1.0 for component in result.embedding)
        assert abs(np.linalg.norm(result.embedding) - 1.0) < 1e-6
        assert result.speech_duration > 0
        assert 0 < result.speech_ratio <= 1
        assert result.inference_latency_ms >= 0
        assert 0 <= result.confidence <= 1


class TestSpeakerServingApi:
    def _client(self) -> TestClient:
        backend = DeterministicTestSpeakerBackend()
        backend.load()
        speaker_extractor = SpeakerEmbeddingExtractor(backend=backend)
        speaker_extractor.load()
        return TestClient(create_app(voice_extractor=speaker_extractor))

    def test_voice_endpoint_returns_backward_compatible_fields(self) -> None:
        client = self._client()
        response = client.post(
            "/v1/embeddings/voice",
            json={"sessionId": "session-1", "payload": encoded(make_wav_bytes(speaker_seed=2))},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["sessionId"] == "session-1"
        assert body["dimension"] == len(body["embedding"])
        assert "confidence" in body
        assert "speechDuration" in body
        assert "speechRatio" in body
        assert "inferenceLatency" in body

    def test_voice_endpoint_returns_structured_error_for_silence(self) -> None:
        client = self._client()
        response = client.post(
            "/v1/embeddings/voice",
            json={"sessionId": "session-1", "payload": encoded(make_wav_bytes(silence=True))},
        )
        assert response.status_code == 404
        assert response.json()["detail"]["error"] == VoiceExtractionErrorCode.NO_SPEECH_DETECTED

    def test_voice_endpoint_returns_structured_error_for_corrupted_audio(self) -> None:
        client = self._client()
        response = client.post(
            "/v1/embeddings/voice",
            json={"sessionId": "session-1", "payload": encoded(b"this-is-not-a-valid-wav-header-at-all")},
        )
        assert response.status_code == 422
        assert response.json()["detail"]["error"] == VoiceExtractionErrorCode.INVALID_AUDIO_FORMAT

    def test_model_is_not_reloaded_per_request(self, extractor: SpeakerEmbeddingExtractor) -> None:
        first_backend = extractor.backend_name
        extractor.extract(make_wav_bytes(speaker_seed=11))
        extractor.extract(make_wav_bytes(speaker_seed=12))
        assert extractor.backend_name == first_backend
