"""Structured AI observability for the model-serving deployable."""

from model_serving.observability.metrics import log_ai_metric
from model_serving.observability.model_registry import ModelVersionRegistry

__all__ = ["ModelVersionRegistry", "log_ai_metric"]
