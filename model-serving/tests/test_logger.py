import logging

from model_serving.config import ModelServingConfig
from model_serving.logger import create_logger


def test_create_logger_uses_configured_name_and_level():
    config = ModelServingConfig(service_name="model-serving-test", log_level="debug")

    logger = create_logger(config)

    assert logger.name == "model-serving-test"
    assert logger.level == logging.DEBUG
