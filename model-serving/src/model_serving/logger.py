"""Structured logging for the model-serving deployable.

Deliberately generic and content-free at M0: this is transport/format
configuration only, mirroring the orchestrator's logger.ts so both
deployables produce comparable structured logs. Any future
embedding/classifier/ASR logging must go through this shared logger rather
than bare print statements.
"""

from __future__ import annotations

import logging
import sys

from model_serving.config import ModelServingConfig


class _JsonLikeFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = (
            f'{{"level":"{record.levelname.lower()}",'
            f'"time":"{self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z")}",'
            f'"name":"{record.name}",'
            f'"msg":"{record.getMessage()}"}}'
        )
        return base


def create_logger(config: ModelServingConfig) -> logging.Logger:
    logger = logging.getLogger(config.service_name)
    logger.setLevel(config.log_level.upper())
    logger.propagate = False

    if not logger.handlers:
        handler = logging.StreamHandler(stream=sys.stdout)
        handler.setFormatter(_JsonLikeFormatter())
        logger.addHandler(handler)

    return logger
