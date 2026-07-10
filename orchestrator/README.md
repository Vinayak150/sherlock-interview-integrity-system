# orchestrator

The modular monolith deployable from the Architecture RFC (§9.2/§9.6): hosts
Bundle Adapters, the Fusion Engine, the State Manager, the Decision/Alert
Engine, and the Explanation Engine as in-process modules — horizontally
replicated and session-sharded, never split into per-modality microservices
(ADR-6).

## Status: M1 — Evidence Store

M0 proved out environment configuration (`src/config.ts`), structured
logging (`src/logger.ts`), and a process entrypoint that starts, logs, and
shuts down cleanly (`src/index.ts`).

M1 adds `src/persistence/` — the Evidence Store (RFC §9.3, ADR-7):

- `db.ts` — the `QueryExecutor`/`TransactionalExecutor`/`DbPool` connection
  abstraction over `pg`, so every other module depends on a narrow interface,
  never the driver directly.
- `migrationRunner.ts` + `migrations/` — a forward-only, idempotent migration
  runner and the two migrations that create `evidence_events` and
  `session_state_snapshots`.
- `migrate.ts` — the CLI entrypoint (`npm run migrate`) that applies pending
  migrations.
- `evidenceEventRepository.ts` / `sessionSnapshotRepository.ts` — the
  `EvidenceEventRepository`/`SessionSnapshotRepository` ports, each with a
  Postgres-backed implementation and an in-memory test double.
- `errors.ts` / `validation.ts` — shared input-validation and error-handling
  primitives (`EvidencePersistenceValidationError` for bad input,
  `EvidenceStoreError` for store failures — never conflated).

**Still deliberately absent:** bundle adapters, Bayesian fusion, the
lifecycle FSM, decision/explanation logic, an API surface, and session
routing. Domain modules are introduced incrementally starting at M2
(`docs/IMPLEMENTATION_PLAN.md`).

## Scripts

- `npm run dev` — run the entrypoint with `tsx` (no build step)
- `npm run build` — compile to `dist/`
- `npm run start` — run the compiled entrypoint
- `npm run migrate` — apply pending Evidence Store migrations (`tsx`, no build step)
- `npm run migrate:built` — apply pending Evidence Store migrations from `dist/`
- `npm run typecheck` — type-check without emitting
- `npm run test` — run the package's tests (Vitest); the Postgres integration
  suite (`src/persistence/integration.test.ts`) is skipped unless
  `RUN_DB_INTEGRATION_TESTS=true` and a reachable database is configured

## Evidence Store connection

Configured via the `POSTGRES_*` environment variables (see
`.env.example`), loaded by `loadConfig()` in `src/config.ts`. Local
development: `make docker-up` starts Postgres, `make migrate` applies the
schema.
