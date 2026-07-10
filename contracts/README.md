# @sherlock/contracts

Cross-component schema/type package shared by `orchestrator/`, `model-serving/`,
`client-agent/`, and `dashboard/`, per the Architecture RFC's repository
structure (§5). This is the single source of truth for shapes like
`EvidenceEvent`, the three-state signal-health contract, `LifecycleState`, and
`EvidenceReport` so these components cannot silently drift on shape between
each other.

## Status: M1 — Evidence Store contracts

This package now defines the storage contracts M1's Evidence Store persists
(RFC §9.3, ADR-7), validated at runtime with [Zod](https://zod.dev/):

- `SignalHealthStatusSchema` — the three-state signal-health contract
  (`OK` / `NO_SIGNAL_DETECTED` / `SERVICE_UNAVAILABLE`, ADR-11).
- `BundleNameSchema` — the nine §4 signal-family bundles.
- `NewEvidenceEventSchema` / `EvidenceEventSchema` — an immutable,
  timestamped, signal-health-tagged observation from one bundle, before and
  after persistence assigns an `id`/`recordedAt`.
- `NewSessionStateSnapshotSchema` / `SessionStateSnapshotSchema` — a
  checkpoint of a session's derived Fusion Engine state, before and after
  persistence assigns an `id`/`createdAt`.

**Still deliberately absent** (arrives with the milestone that needs it): the
eight-state `LifecycleState` enum (M4), the `EvidenceReport` shape (M6), and
bundle-specific payload schemas (M2/M9/M10/M11) — `value` and `state` above
are intentionally opaque, JSON-serializable payloads so this package does not
need to be revisited every time a later milestone adds a signal.

## Scripts

- `npm run build` — compile to `dist/`
- `npm run typecheck` — type-check without emitting
- `npm run test` — run the package's tests (Vitest)
