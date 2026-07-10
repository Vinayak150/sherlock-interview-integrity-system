from model_serving.config import load_config


def test_defaults_are_safe_for_local_development(monkeypatch):
    monkeypatch.delenv("MODEL_SERVING_SERVICE_NAME", raising=False)
    monkeypatch.delenv("MODEL_SERVING_LOG_LEVEL", raising=False)

    config = load_config()

    assert config.service_name == "model-serving"
    assert config.log_level == "info"


def test_respects_explicit_environment_variables(monkeypatch):
    monkeypatch.setenv("MODEL_SERVING_SERVICE_NAME", "model-serving-test")
    monkeypatch.setenv("MODEL_SERVING_LOG_LEVEL", "debug")

    config = load_config()

    assert config.service_name == "model-serving-test"
    assert config.log_level == "debug"
