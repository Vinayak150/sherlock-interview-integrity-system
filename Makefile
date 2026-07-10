.PHONY: install install-ts install-py lint lint-ts lint-py format format-ts format-py \
	typecheck typecheck-ts typecheck-py test test-ts test-py build build-ts \
	docker-build docker-up docker-down docker-logs migrate ci

# --- Install ---

install: install-ts install-py

install-ts:
	npm install

install-py:
	cd model-serving && pip install -e ".[dev]"

# --- Lint ---

lint: lint-ts lint-py

lint-ts:
	npm run lint

lint-py:
	cd model-serving && ruff check .

# --- Format ---

format: format-ts format-py

format-ts:
	npm run format

format-py:
	cd model-serving && ruff format --check .

# --- Typecheck ---

typecheck: typecheck-ts typecheck-py

typecheck-ts:
	npm run typecheck

typecheck-py:
	cd model-serving && mypy src

# --- Test ---

test: test-ts test-py

test-ts:
	npm run test

test-py:
	cd model-serving && pytest

# --- Build ---

build: build-ts

build-ts:
	npm run build

# --- Docker ---

docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

# --- Evidence Store migrations (RFC §9.3, ADR-7) ---

migrate:
	npm run migrate --workspace=@sherlock/orchestrator

# --- CI entrypoint (mirrors .github/workflows/ci.yml locally) ---

ci: lint typecheck test build
