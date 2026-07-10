# orchestrator

The modular monolith deployable from the Architecture RFC (§9.2/§9.6): hosts
Bundle Adapters, the Fusion Engine, the State Manager, the Decision/Alert
Engine, and the Explanation Engine as in-process modules — horizontally
replicated and session-sharded, never split into per-modality microservices
(ADR-6).

## Status: M8 — External Interfaces/API Layer (M3–M8 complete)

M0 proved out environment configuration (`src/config.ts`), structured
logging (`src/logger.ts`), and a process entrypoint that starts, logs, and
shuts down cleanly (`src/index.ts`).

M1 added `src/persistence/` — the Evidence Store (RFC §9.3, ADR-7):

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

M2 (current) adds the first vertical slice with zero ML dependency
(`docs/IMPLEMENTATION_PLAN.md`, Milestone M2):

- `src/bundles/types.ts` — the shared `BundleAdapter<TInput>` shape every
  Bundle Adapter implements, plus a `makeEvidenceEvent` helper.
- `src/bundles/claim/` — the Claim Bundle Adapter (RFC §4-A): pre-call
  identity-claim signals (display name, email domain, calendar-invite,
  reference-photo/prior-ID-verification/account-history presence), compared
  against an `IdentityClaimRecord` fetched from the M2 **ATS-integration
  stub** (`atsClient.ts` — an `AtsClient` port with an in-memory
  implementation; no real ATS/scheduling integration is built at this
  milestone).
- `src/bundles/metadata/` — the Metadata Bundle Adapter (RFC §4-B):
  session/platform metadata signals (join method, IP-geolocation and
  device-fingerprint consistency, virtual-capture-device detection,
  screen-share state, multi-monitor detection) computed directly from a
  join event — no external lookup, so this adapter is synchronous.
- `src/statemachine/coldStart.ts` — the M2-scoped subset of RFC §6's
  eight-state lifecycle: only `UNKNOWN`/`POSSIBLE_CANDIDATE`, no hysteresis
  or dwell-time (those arrive with the full FSM at M4). Transitions on
  "weak claim-match evidence" per §6's state diagram, honoring the
  three-state signal-health contract (`SERVICE_UNAVAILABLE` excluded from
  evidence entirely, per ADR-11/§13) even though the Fusion Engine that
  formalizes that rule doesn't exist until M3.
- `src/coldStartVerticalSlice.test.ts` — an end-to-end test proving the
  slice: bundle adapters → Evidence Store (M1) → cold-start state manager.

Every new §4-A/§4-B `EvidenceEvent.value` payload shape is a schema in
`@sherlock/contracts` (`ClaimMatchValue`, `ClaimPresenceValue`,
`JoinMethodValue`, `MetadataConsistencyValue`, `MetadataDetectionValue`,
`ScreenShareStateValue`), so the wire shape can't drift between this
package and any future consumer.

M3 added `src/fusion/` — the Fusion Engine (RFC §5, ADR-1):

- `beta.ts` — regularized-incomplete-beta / quantile / credible-interval
  numerics (Lanczos `logGamma`, Lentz's continued-fraction algorithm).
- `decay.ts` — RFC §7's exponential half-life decay for ordinary evidence.
- `likelihoodRatios.ts` — the hand-set, expert-elicited log-likelihood-ratio
  registry for every Claim/Metadata signal (M2), isolated in one swappable
  table per Plan §8's recalibration-seam risk.
- `fusionEngine.ts` — `FusionEngine.computePosterior`: bundle-local,
  decayed log-odds accumulation -> a `FusionPosterior` (probability + Beta
  credible interval). Takes persisted `EvidenceEvent[]` only, never
  `NewEvidenceEvent[]`, structurally enforcing "ledger-authoritative-before-
  score ordering" (Plan §9).

M4 added the full eight-state lifecycle FSM to `src/statemachine/`
(`lifecycle.ts`, RFC §6/ADR-4) alongside M2's `coldStart.ts` (left
untouched — nothing depends on it): hysteresis + minimum dwell-time on the
climbing ladder, `LOST_CONFIDENCE`/`DISQUALIFIED`/`RECOVERED` with a
permanent, append-only recovery annotation, and `DISQUALIFIED`'s ADR-3
invariant (no automatic exit — only `LifecycleStateManager.applyHumanOverride`).
A `ContradictionSignal` input is the seam for Plan M9's real change-point
detector, deliberately not built out further here.

M5/M6 add `src/decision/` and `src/explanation/` as **independent sibling
modules with zero imports between them** (verified by a source-scan test,
not just by convention) — the Decision Engine never generates a report;
the Evidence Report Engine never makes a decision:

- `decision/` (RFC §10): `DecisionEngine` produces a structured `Decision`
  per lifecycle evaluation — abstention (`UNKNOWN`, unflagged, the _only_
  RFC-defined policy, no anti-gaming heuristics), tie-break
  `AMBIGUOUS — needs adjudication`, a `ReviewerRecommendation`, and a
  low-noise `Alert` (deduplicated so an ongoing condition doesn't re-alert
  every tick) carrying only an immutable `EvidenceReference` — never a
  formatted report.
- `explanation/` (RFC §8): `ExplanationEngine.buildReport` deterministically
  ranks contributing signals by `|log LR|`, separates contradictory
  evidence from missing evidence (`NO_SIGNAL_DETECTED`/`SERVICE_UNAVAILABLE`,
  never conflated with "evidence against"), and leaves `alternativeHypotheses`
  honestly empty until visual/audio/role-assignment bundles exist (M9-M11).
  The constrained-LLM prose layer (RFC §8) is Plan M12's job, not built here.

M7 (Plan: "Session routing & horizontal replication") added
`src/routing/` (RFC §9.4, ADR-8):

- `consistentHashRing.ts` — a pure, dependency-free consistent-hash ring
  (SHA-1-derived positions, virtual nodes) proving the core property that
  makes consistent hashing worth using: adding/removing a replica remaps
  only a small fraction of sessions.
- `redisClient.ts` / `sessionRegistry.ts` — the narrow `RedisClientPort`
  (an `ioredis` wrapper, mirroring `persistence/db.ts`'s dependency-
  inversion shape) and the `SessionRegistry` port, with a Redis-backed
  implementation (compare-and-release semantics, a TTL so an abandoned
  session's entry does not live forever) and an in-memory test double.
- `sessionRouter.ts` — `SessionRouter`: prefers a session's already-
  recorded owner when still known-healthy; falls back to a fresh hash-ring
  computation on a stale/removed owner or a registry read/write failure
  ("stale routing, not data loss," RFC §9.4).
- `lifecycleSnapshotCodec.ts` / `sessionLifecycleStore.ts` —
  `SessionLifecycleStore`: the recovery-aware wrapper around M4's
  `LifecycleStateManager`. On first touch of a session on a given
  instance, it loads the last durable snapshot (M1's
  `SessionSnapshotRepository`) and restores it via a new, purely additive
  `LifecycleStateManager.restoreRecord` method, rather than starting over
  at `UNKNOWN`; it persists a fresh snapshot whenever a transition
  actually occurs. (Note: RFC §9.3 describes snapshot content as Fusion
  Engine state; this codebase's `FusionEngine`, M3, is stateless per call
  and recomputes cheaply from the evidence ledger, so the concrete,
  non-recomputable state this milestone snapshots is the Lifecycle FSM's
  record instead — see the module's doc comment for the full rationale.)

M8 (this document's "External Interfaces/API Layer" — see the note below
on numbering) added `src/api/`:

- `schemas.ts` — Zod request-body validation, reusing `@sherlock/contracts`
  enums directly so the HTTP boundary cannot drift from the wire contract.
- `sessionOrchestrationService.ts` — `SessionOrchestrationService`: the
  thin, framework-agnostic orchestration sequencing bundle adapters (M2) →
  Evidence Store (M1) → Fusion Engine (M3) → recovery-aware Lifecycle FSM
  (M4/M7) → Decision Engine (M5) → Evidence Report Engine (M6, only when a
  `Decision` carries an `Alert`). No fusion, lifecycle, decision, or
  explanation logic is duplicated here — every method is a fixed call
  sequence into already-built engines.
- `httpServer.ts` — a minimal, dependency-free (`node:http`) HTTP surface:
  `POST /sessions/:id/evidence`, `GET /sessions/:id/status`, `GET
/health`. Three routes did not justify a new router-library dependency.

`src/index.ts` now wires all of the above into a real, listening process
(Postgres-backed Evidence Store, the HTTP server) — the first milestone
where the entrypoint does real work beyond starting/logging/shutting down.
It deliberately does not construct a `SessionRouter`: RFC §9.4 places
routing _enforcement_ at the load balancer, and a single-instance
`docker-compose` topology has no routing decision to make yet — `routing/`
is fully built and tested as the building block a real multi-replica
deployment's load balancer would consult (ADR-14's phased-infrastructure
philosophy).

**A note on this batch's milestone numbering.** The Implementation Plan's
own M8 is "Model-Serving Layer stood up" (a Python/GPU-inference
deployable) — this batch instead built the `orchestrator/api/` ingress
layer named in the Plan's repository structure (§5) but not assigned a
milestone number there. This was a deliberate, explicitly-flagged
substitution for this batch, not a silent reinterpretation of the Plan.

**Still deliberately absent:** the real CUSUM/change-point detector (M9);
the per-event log-LR clamp (M14); the real Model-Serving Layer (Plan's own
M8); visual/audio/linguistic/device/elicitation bundles (M9-M11); the LLM
narrative layer (M12); a real ATS/scheduling integration (still
`InMemoryAtsClient`, per M2); WebSocket/SSE push to a dashboard (M13).
Domain modules are introduced incrementally per
`docs/IMPLEMENTATION_PLAN.md`.

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
