"""Environment management for the model-serving deployable."""

from __future__ import annotations

import os

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class ModelServingConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MODEL_SERVING_",
        extra="ignore",
    )

    service_name: str = "model-serving"
    log_level: str = "info"
    http_port: int = Field(default=8081)
    http_host: str = "0.0.0.0"
    insightface_model_name: str = "buffalo_l"
    insightface_det_size: int = 640
    speaker_backend: str = "auto"
    minifasnet_model_path: str | None = None
    silentface_model_path: str | None = None


def load_config() -> ModelServingConfig:
    config = ModelServingConfig()

    port = os.environ.get("PORT")
    if port is not None:
        config.http_port = int(port)

    return config
