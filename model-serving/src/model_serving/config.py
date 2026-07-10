"""Environment management for the model-serving deployable.

M0 scope covered the small set of variables the process needs to start and
log correctly. M8 adds the serving API's listen address -- no GPU pool or
model registry configuration exists yet, since no real model is loaded
(see `embeddings/extractor.py`, `liveness/detector.py`).
"""

from __future__ import annotations

import os

from pydantic_settings import BaseSettings, SettingsConfigDict


class ModelServingConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MODEL_SERVING_",
        extra="ignore",
    )

    service_name: str = "model-serving"
    log_level: str = "info"

    # Railway provides PORT automatically. Fall back to
    # MODEL_SERVING_HTTP_PORT for local/dev, then 8081.
    http_port: int = int(
        os.getenv("PORT")
        or os.getenv("MODEL_SERVING_HTTP_PORT", "8081")
    )

    http_host: str = "0.0.0.0"


def load_config() -> ModelServingConfig:
    return ModelServingConfig()