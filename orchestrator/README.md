# orchestrator

The modular monolith deployable from the Architecture RFC (§9.2/§9.6): hosts
Bundle Adapters, the Fusion Engine, the State Manager, the Decision/Alert
Engine, and the Explanation Engine as in-process modules — horizontally
replicated and session-sharded, never split into per-modality microservices
(ADR-6).

## Status: M0 scaffold

This deployable currently contains **no domain modules** — no bundles, no
fusion math, no state machine, no decision/explanation logic, no
persistence, no API surface. It only proves out:

- environment configuration (`src/config.ts`)
- structured logging (`src/logger.ts`)
- a process entrypoint that starts, logs, and shuts down cleanly
  (`src/index.ts`)

Domain modules are introduced incrementally starting at M1
(`docs/IMPLEMENTATION_PLAN.md`).

## Scripts

- `npm run dev` — run the entrypoint with `tsx` (no build step)
- `npm run build` — compile to `dist/`
- `npm run start` — run the compiled entrypoint
- `npm run typecheck` — type-check without emitting
- `npm run test` — run the package's tests (Vitest)
