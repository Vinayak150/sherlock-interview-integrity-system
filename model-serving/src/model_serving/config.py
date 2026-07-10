"""Environment management for the model-serving deployable.

M0 scope covered the small set of variables the process needs to start and
log correctly. M8 adds the serving API's listen address -- no GPU pool or
model registry configuration exists yet, since no real model is loaded
(see `embeddings/extractor.py`, `liveness/detector.py`).
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class ModelServingConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MODEL_SERVING_",
        extra="ignore",
    )

    service_name: str = "model-serving"
    log_level: str = "info"

    # Local development default
    http_port: int = Field(default=8081)

    http_host: str = "0.0.0.0"


def load_config() -> ModelServingConfig:
    config = ModelServingConfig()

    # Railway injects PORT. Override after settings creation.
    import os

    port = os.environ.get("PORT")
    if port is not None:
        config.http_port = int(port)

    return config