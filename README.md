# Sherlock — Real-Time Candidate Identity & Interview-Integrity System

This repository implements the system designed in [`docs/architecture.md`](docs/architecture.md)
(the Architecture RFC — the **only** authoritative source for _what_ to
build) following the sequencing in
[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) (the
Implementation Plan — the authoritative source for _how_ to build it,
incrementally). Neither document is redesigned, simplified, or
second-guessed by this codebase; implementation follows them faithfully,
milestone by milestone.

## Current status: Milestone M1 — Evidence Store

M0 established the project foundation (repository initialization, dependency
management, containerization, linting, formatting, type-checking, testing,
logging, environment management, CI/CD) with no domain code.

M1 adds the Evidence Store (RFC §9.3, ADR-7) — "one relational database"
holding the two tables the rest of the system leans on:

- `evidence_events` — the append-only, immutable-once-written audit ledger
  (`orchestrator/src/persistence/migrations/0001_create_evidence_events.ts`).
- `session_state_snapshots` — periodic Fusion Engine state checkpoints for
  fast crash recovery
  (`orchestrator/src/persistence/migrations/0002_create_session_state_snapshots.ts`).

Along with the schema: the `EvidenceEvent`/`SessionStateSnapshot` storage
contracts and the three-state signal-health contract (`@sherlock/contracts`),
a forward-only migration runner, and Postgres-backed + in-memory
implementations of the `EvidenceEventRepository`/`SessionSnapshotRepository`
ports. **Still deliberately absent:** Bayesian fusion, the lifecycle state
machine, bundle adapters, decision/explanation logic, and any API surface —
those arrive starting at M2 per `docs/IMPLEMENTATION_PLAN.md`.

## Repository layout

Matches the RFC's repository structure (§5); folders not yet needed
(`client-agent/`, `dashboard/`, `eval/`, `infra/`, `docs/adr/`) are introduced
by the milestones that need them, not created empty ahead of time.

```
.
├── contracts/       # @sherlock/contracts — cross-component schema package: EvidenceEvent, SessionStateSnapshot, signal-health, bundle names (M1)
├── orchestrator/    # modular monolith deployable (§9.2) — src/persistence/ (Evidence Store, M1); domain modules arrive M2+
├── model-serving/   # GPU-bound inference deployable (§9.2) — scaffold only; M0
├── docs/
│   ├── architecture.md          # Architecture RFC (authoritative WHAT)
│   └── IMPLEMENTATION_PLAN.md   # Implementation Plan (authoritative HOW)
├── docker-compose.yml            # local dev topology: postgres, redis, orchestrator, model-serving
├── Makefile                      # unified commands across the TypeScript and Python workspaces
└── .github/workflows/ci.yml      # CI: lint, typecheck, test (incl. Postgres integration), build, docker build — every push/PR
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
make migrate         # apply Evidence Store migrations (RFC §9.3) against postgres
make docker-logs
make docker-down
```

`redis` is provisioned as infrastructure only — no routing logic runs
against it yet (that lands in M7). `postgres` now has real schema, applied
explicitly via `make migrate` (never implicitly on container/process start).

### Running the Evidence Store integration suite

The default `make test` / `npm run test` runs entirely against mocks and
in-memory fakes — no external services required. To additionally exercise
the real migration SQL and repository queries against a live Postgres
instance:

```bash
make docker-up   # starts postgres (and redis)
make migrate
RUN_DB_INTEGRATION_TESTS=true npm run test --workspace=@sherlock/orchestrator
```

CI runs this integration suite on every push/PR against a Postgres service
container (`.github/workflows/ci.yml`).

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
(M0–M16). M0 was scaffolding; M1 (current) delivers the Evidence Store; domain
logic (bundles, fusion, the lifecycle FSM, decision/explanation engines) is
built incrementally from M2 onward.
