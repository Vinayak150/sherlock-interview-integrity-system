"""Structured metric logging compatible with Prometheus/OpenTelemetry exporters."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

METRIC_INFERENCE_LATENCY_MS = "sherlock.ai.inference.latency_ms"
METRIC_MODEL_VERSION = "sherlock.ai.model.version"
METRIC_CONFIDENCE_DISTRIBUTION = "sherlock.ai.confidence.distribution"
METRIC_SPOOF_DETECTION_RATE = "sherlock.ai.spoof.detection_rate"
METRIC_SPEAKER_CONFIDENCE_DISTRIBUTION = "sherlock.ai.speaker.confidence.distribution"
METRIC_FACE_CONFIDENCE_DISTRIBUTION = "sherlock.ai.face.confidence.distribution"
OBSERVABILITY_LOG_MESSAGE = "ai_metric"


def confidence_bucket(probability: float) -> str:
    if not 0.0 <= probability <= 1.0:
        raise ValueError(f"probability must be within [0, 1], received {probability}")
    if probability < 0.2:
        return "0.0-0.2"
    if probability < 0.4:
        return "0.2-0.4"
    if probability < 0.6:
        return "0.4-0.6"
    if probability < 0.8:
        return "0.6-0.8"
    return "0.8-1.0"


def log_ai_metric(
    logger: logging.Logger,
    *,
    metric_name: str,
    metric_type: str,
    value: float | int | bool,
    labels: dict[str, Any] | None = None,
    observed_at: datetime | None = None,
) -> None:
    payload = {
        "level": "info",
        "time": (observed_at or datetime.now(tz=UTC)).isoformat(),
        "msg": OBSERVABILITY_LOG_MESSAGE,
        "observability": {
            "schemaVersion": "1",
            "metricName": metric_name,
            "metricType": metric_type,
            "value": value,
            "labels": labels or {},
            "observedAt": (observed_at or datetime.now(tz=UTC)).isoformat(),
        },
    }
    logger.info(json.dumps(payload, separators=(",", ":"), sort_keys=True))
