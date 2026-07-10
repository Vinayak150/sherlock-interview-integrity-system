# model-serving

The one separate deployable justified by the Architecture RFC (§9.2, ADR-6):
GPU-bound inference — embedding extraction, liveness/anti-spoof, deepfake and
voice-clone classifiers, ASR — stateless, autoscaled independently of the
orchestrator's session count.

## Status: M0 scaffold

This deployable currently loads **no models** and exposes **no serving
API**. It only proves out:

- environment configuration (`src/model_serving/config.py`)
- structured logging (`src/model_serving/logger.py`)
- a process entrypoint that starts and logs correctly
  (`src/model_serving/main.py`)

Real inference modules (`embeddings/`, `liveness/`, `deepfake_classifier/`,
`voice_clone_classifier/`, `asr/`, `serving_api/`) are introduced at M8
(`docs/IMPLEMENTATION_PLAN.md`).

## Local development

```bash
pip install -e ".[dev]"
python -m model_serving.main
```

## Scripts (via the repo-root Makefile)

- `make lint-py` — Ruff lint
- `make format-py` — Ruff format check
- `make typecheck-py` — mypy
- `make test-py` — pytest
