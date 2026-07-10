"""Environment management for the model-serving deployable.

M0 scope: read and validate the small set of variables the process needs to
start and log correctly. No GPU pool, model registry, or RPC-serving
configuration belongs here yet -- that arrives with M8.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class ModelServingConfig(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MODEL_SERVING_", extra="ignore")

    service_name: str = "model-serving"
    log_level: str = "info"


def load_config() -> ModelServingConfig:
    return ModelServingConfig()
