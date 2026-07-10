# Sherlock — Real-Time Candidate Identity & Interview-Integrity System

This repository implements the system designed in [`docs/architecture.md`](docs/architecture.md)
(the Architecture RFC — the **only** authoritative source for _what_ to
build) following the sequencing in
[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) (the
Implementation Plan — the authoritative source for _how_ to build it,
incrementally). Neither document is redesigned, simplified, or
second-guessed by this codebase; implementation follows them faithfully,
milestone by milestone.

## Current status: Milestone M0 — repository & tooling scaffolding

M0 establishes the project foundation every later milestone depends on:
repository initialization, dependency management, containerization, linting,
formatting, type-checking, testing, logging, environment management, and
CI/CD.

**M0 deliberately contains no domain code.** There is no Bayesian fusion, no
state machine, no evidence/decision engine, no database models, no APIs, no
authentication, and no AI models yet. Every module that exists today is a
minimal, compiling, testable scaffold whose only job is to prove the
deployables start correctly — real domain logic arrives starting at M1 per
`docs/IMPLEMENTATION_PLAN.md`.

## Repository layout

Matches the RFC's repository structure (§5); folders not yet needed by M0
(`client-agent/`, `dashboard/`, `eval/`, `infra/`, `docs/adr/`) are introduced
by the milestones that need them, not created empty ahead of time.

```
.
├── contracts/       # @sherlock/contracts — cross-component schema package (empty scaffold; M0)
├── orchestrator/    # modular monolith deployable (§9.2) — scaffold only; M0
├── model-serving/   # GPU-bound inference deployable (§9.2) — scaffold only; M0
├── docs/
│   ├── architecture.md          # Architecture RFC (authoritative WHAT)
│   └── IMPLEMENTATION_PLAN.md   # Implementation Plan (authoritative HOW)
├── docker-compose.yml            # local dev topology: postgres, redis, orchestrator, model-serving
├── Makefile                      # unified commands across the TypeScript and Python workspaces
└── .github/workflows/ci.yml      # CI: lint, typecheck, test, build, docker build — every push/PR
```

## Why two languages

Per §6 of the Implementation Plan ("Technology Stack (Inferred)"), the RFC
specifies no language, only architectural properties:

- **`orchestrator/` and `contracts/` — TypeScript on Node.js.** The
  orchestrator's properties (many lightweight, memory/IO-bound, per-session
  state machines; in-process modules; horizontal replication) fit a typed,
  concurrency-native runtime; TypeScript/Node.js was chosen as one of the
  RFC's named plausible fits.
- **`model-serving/` — Python.** Named directly in the plan as "the
  practical inference-ecosystem default" for the GPU-bound classifiers and
  ASR this deployable will eventually host.

## Prerequisites

- Node.js ≥ 20 and npm ≥ 10
- Python ≥ 3.11
- Docker and Docker Compose (for containerized local development)

## Getting started

```bash
cp .env.example .env

# Install everything (TypeScript workspaces + the Python package)
make install

# Lint, type-check, and test everything
make ci

# Or, run each deployable directly without Docker:
npm run dev --workspace=@sherlock/orchestrator
python -m model_serving.main   # from within model-serving/, after `pip install -e ".[dev]"`
```

### Running with Docker Compose

```bash
make docker-up      # postgres + redis + orchestrator + model-serving
make docker-logs
make docker-down
```

`postgres` and `redis` are provisioned here as infrastructure only — no
schema, migration, or routing logic runs against them yet (that lands in
M1 and M7 respectively).

## Tooling reference

| Concern               | TypeScript (`contracts/`, `orchestrator/`) | Python (`model-serving/`)                                 |
| --------------------- | ------------------------------------------ | --------------------------------------------------------- |
| Dependency management | npm workspaces                             | `pyproject.toml` (setuptools) + `pip install -e ".[dev]"` |
| Linting               | ESLint (flat config, `eslint.config.mjs`)  | Ruff (`ruff check`)                                       |
| Formatting            | Prettier                                   | Ruff (`ruff format`)                                      |
| Typing                | `tsc --strict`                             | mypy (`strict = true`)                                    |
| Testing               | Vitest                                     | pytest                                                    |
| Logging               | `pino` (structured, JSON)                  | stdlib `logging` (structured JSON-like formatter)         |

Every command above is also reachable through the root `Makefile` (`make
lint`, `make format`, `make typecheck`, `make test`, `make build`) so a
single entrypoint works across both languages.

## CI/CD

`.github/workflows/ci.yml` runs on every push and pull request:

1. **`typescript`** — install, lint, format-check, typecheck, test, build the
   `contracts` and `orchestrator` workspaces.
2. **`python`** — install, lint, format-check, typecheck, test
   `model-serving`.
3. **`docker`** — build both deployables' Docker images and validate
   `docker-compose.yml`, gated on the two jobs above passing.

## Roadmap

See `docs/IMPLEMENTATION_PLAN.md` §7 for the full milestone sequence
(M0–M16). M0 is scaffolding; M1 begins the Evidence Store, and domain logic
(bundles, fusion, the lifecycle FSM, decision/explanation engines) is built
incrementally from M2 onward.
