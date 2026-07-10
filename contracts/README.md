# @sherlock/contracts

Cross-component schema/type package shared by `orchestrator/`, `model-serving/`,
`client-agent/`, and `dashboard/`, per the Architecture RFC's repository
structure (§5). This is the single source of truth for shapes like
`EvidenceEvent`, the three-state signal-health contract, `LifecycleState`, and
`EvidenceReport` so these components cannot silently drift on shape between
each other.

## Status: M0 scaffold

This package currently contains **no domain contracts** — only enough to
build, lint, typecheck, and test as an empty TypeScript package. Real
contract types are introduced by the milestone that first needs them, per
`docs/IMPLEMENTATION_PLAN.md`.

## Scripts

- `npm run build` — compile to `dist/`
- `npm run typecheck` — type-check without emitting
- `npm run test` — run the package's tests (Vitest)
