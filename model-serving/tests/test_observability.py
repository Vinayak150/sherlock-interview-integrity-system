from __future__ import annotations

import json
import logging

from model_serving.observability.metrics import (
    METRIC_CONFIDENCE_DISTRIBUTION,
    METRIC_FACE_CONFIDENCE_DISTRIBUTION,
    METRIC_INFERENCE_LATENCY_MS,
    METRIC_MODEL_VERSION,
    METRIC_SPOOF_DETECTION_RATE,
    OBSERVABILITY_LOG_MESSAGE,
    confidence_bucket,
    log_ai_metric,
)
from model_serving.observability.model_registry import ModelVersionRegistry


class _ListHandler(logging.Handler):
    def __init__(self, records: list[str]) -> None:
        super().__init__()
        self._records = records

    def emit(self, record: logging.LogRecord) -> None:
        self._records.append(record.getMessage())


def test_confidence_bucket_maps_to_histogram_bins() -> None:
    assert confidence_bucket(0.1) == "0.0-0.2"
    assert confidence_bucket(0.55) == "0.4-0.6"
    assert confidence_bucket(0.95) == "0.8-1.0"


def test_log_ai_metric_emits_structured_json() -> None:
    logger = logging.getLogger("observability-test")
    logger.handlers.clear()
    logger.setLevel(logging.INFO)
    logger.propagate = False

    lines: list[str] = []
    logger.addHandler(_ListHandler(lines))

    log_ai_metric(
        logger,
        metric_name=METRIC_INFERENCE_LATENCY_MS,
        metric_type="histogram",
        value=12.5,
        labels={"endpoint": "/v1/liveness/visual", "model": "minifasnet"},
    )

    assert len(lines) == 1
    payload = json.loads(lines[0])
    assert payload["msg"] == OBSERVABILITY_LOG_MESSAGE
    assert payload["observability"]["metricName"] == METRIC_INFERENCE_LATENCY_MS
    assert payload["observability"]["metricType"] == "histogram"
    assert payload["observability"]["value"] == 12.5


def test_model_version_registry_labels_include_backends() -> None:
    registry = ModelVersionRegistry(
        face_model="buffalo_l",
        voice_backend="speechbrain",
        liveness_backend="minifasnet",
        service_version="0.0.0",
    )
    labels = registry.label_set("/v1/embeddings/face")
    assert labels["face_model"] == "buffalo_l"
    assert labels["voice_backend"] == "speechbrain"
    assert labels["liveness_backend"] == "minifasnet"

    logger = logging.getLogger("observability-test-version")
    logger.handlers.clear()
    logger.setLevel(logging.INFO)
    logger.propagate = False
    lines: list[str] = []
    logger.addHandler(_ListHandler(lines))

    log_ai_metric(
        logger,
        metric_name=METRIC_MODEL_VERSION,
        metric_type="info",
        value=1,
        labels=labels,
    )
    payload = json.loads(lines[0])
    assert payload["observability"]["metricName"] == METRIC_MODEL_VERSION
    assert payload["observability"]["labels"]["endpoint"] == "/v1/embeddings/face"


def test_spoof_and_confidence_metrics_use_counter_semantics() -> None:
    logger = logging.getLogger("observability-test-spoof")
    logger.handlers.clear()
    logger.setLevel(logging.INFO)
    logger.propagate = False
    lines: list[str] = []
    logger.addHandler(_ListHandler(lines))

    log_ai_metric(
        logger,
        metric_name=METRIC_SPOOF_DETECTION_RATE,
        metric_type="counter",
        value=1,
        labels={"signal": "visual_liveness"},
    )
    log_ai_metric(
        logger,
        metric_name=METRIC_CONFIDENCE_DISTRIBUTION,
        metric_type="counter",
        value=1,
        labels={"bucket": confidence_bucket(0.82), "confidenceKind": "liveness"},
    )
    log_ai_metric(
        logger,
        metric_name=METRIC_FACE_CONFIDENCE_DISTRIBUTION,
        metric_type="counter",
        value=1,
        labels={"bucket": confidence_bucket(0.91)},
    )

    assert len(lines) == 3
    spoof_payload = json.loads(lines[0])
    assert spoof_payload["observability"]["metricName"] == METRIC_SPOOF_DETECTION_RATE
