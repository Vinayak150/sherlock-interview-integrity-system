"""Model version registry for observability labels."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelVersionRegistry:
    face_model: str
    voice_backend: str
    liveness_backend: str
    service_version: str = "0.0.0"

    def label_set(self, endpoint: str) -> dict[str, str]:
        return {
            "layer": "model_serving",
            "endpoint": endpoint,
            "face_model": self.face_model,
            "voice_backend": self.voice_backend,
            "liveness_backend": self.liveness_backend,
            "service_version": self.service_version,
        }
