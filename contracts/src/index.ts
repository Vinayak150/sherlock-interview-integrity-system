/**
 * @sherlock/contracts
 *
 * Cross-component schemas (RFC §5 repository structure) so the orchestrator,
 * model-serving, client-agent, and dashboard workspaces cannot drift on
 * shape between each other.
 *
 * M1 scope (`docs/IMPLEMENTATION_PLAN.md`, Milestone M1 — "Evidence Store"):
 * this module introduces the two record shapes the Evidence Store persists
 * durably (RFC §9.3, ADR-7) —
 *
 *   - `EvidenceEvent`: "a single, timestamped, signal-health-tagged
 *     observation from one bundle ... Immutable once written." (Plan §2)
 *   - `SessionStateSnapshot`: "a periodic checkpoint of a Session's derived
 *     state for fast crash recovery." (Plan §2, RFC §9.3)
 *
 * Deliberately NOT introduced yet (out of scope for M1, arrives with the
 * milestones that need them): the eight-state `LifecycleState` enum (M4),
 * the `EvidenceReport` shape (M6), and bundle-specific payload schemas
 * (M2/M9/M10/M11). `value`/`state` below are intentionally generic
 * (`unknown`, JSON-serializable) so the persistence layer does not have to
 * be revisited every time a later milestone adds a new signal or changes
 * the Fusion Engine's internal representation — the schema this package
 * owns is the *storage contract*, not the Fusion Engine's internal math.
 */
import { z } from 'zod';

export const CONTRACTS_PACKAGE_NAME = '@sherlock/contracts' as const;

/**
 * The three-state signal-health contract (RFC §13, ADR-11).
 *
 * `OK` and `NO_SIGNAL_DETECTED` carry evidentiary weight; `SERVICE_UNAVAILABLE`
 * must never be treated as negative evidence by anything downstream — that
 * business rule belongs to the Fusion Engine (M3), not this package, but the
 * three-way distinction itself must exist at the storage layer so it is
 * never lost between "the detector said no" and "the detector didn't
 * answer."
 */
export const SIGNAL_HEALTH_STATUSES = ['OK', 'NO_SIGNAL_DETECTED', 'SERVICE_UNAVAILABLE'] as const;

export const SignalHealthStatusSchema = z.enum(SIGNAL_HEALTH_STATUSES);

export type SignalHealthStatus = z.infer<typeof SignalHealthStatusSchema>;

/**
 * Signal-family bundles (RFC §4, Plan §5 repository structure
 * `orchestrator/bundles/*`). A bundle is the unit of correlation
 * containment (RFC §5) — every evidence event belongs to exactly one.
 */
export const BUNDLE_NAMES = [
  'claim',
  'metadata',
  'visual',
  'audio',
  'linguistic',
  'device',
  'elicitation',
  'meta',
  'cross_session',
] as const;

export const BundleNameSchema = z.enum(BUNDLE_NAMES);

export type BundleName = z.infer<typeof BundleNameSchema>;

/**
 * `NewEvidenceEvent` — the shape a Bundle Adapter (M2+) supplies to the
 * Evidence Store before persistence assigns an `id` and a `recordedAt`
 * write-timestamp. `occurredAt` is the signal's own observation time,
 * distinct from `recordedAt` (write time) so evidence-arrival latency stays
 * inspectable (RFC §12).
 *
 * `value` is deliberately `unknown` (JSON-serializable): its concrete shape
 * is owned by whichever bundle adapter produced it (a float similarity
 * score, a boolean match flag, a structured artifact-classifier result,
 * ...), not by the persistence layer.
 */
export const NewEvidenceEventSchema = z.object({
  sessionId: z.string().trim().min(1, 'sessionId must not be empty'),
  bundle: BundleNameSchema,
  signalName: z.string().trim().min(1, 'signalName must not be empty'),
  healthStatus: SignalHealthStatusSchema,
  value: z.unknown().nullable(),
  occurredAt: z.date(),
  metadata: z.record(z.string(), z.unknown()).nullable().default(null),
});

export type NewEvidenceEvent = z.infer<typeof NewEvidenceEventSchema>;

/**
 * `EvidenceEvent` — a persisted, immutable record (Plan §2 domain model).
 */
export const EvidenceEventSchema = NewEvidenceEventSchema.extend({
  id: z.string().uuid(),
  recordedAt: z.date(),
});

export type EvidenceEvent = z.infer<typeof EvidenceEventSchema>;

/**
 * `NewSessionStateSnapshot` — a checkpoint of a session's derived Fusion
 * Engine state (RFC §9.3), supplied for persistence. `sequence` is a
 * per-session, monotonically increasing checkpoint number (not a
 * timestamp) so "the latest snapshot" is an unambiguous, race-free query
 * even under clock skew. `state` is intentionally an opaque JSON payload —
 * the Fusion Engine (M3) owns its internal representation (log-odds
 * accumulator, Beta parameters per bundle); this package only owns the
 * durable-storage envelope around it.
 */
export const NewSessionStateSnapshotSchema = z.object({
  sessionId: z.string().trim().min(1, 'sessionId must not be empty'),
  sequence: z.number().int().nonnegative(),
  state: z.record(z.string(), z.unknown()),
});

export type NewSessionStateSnapshot = z.infer<typeof NewSessionStateSnapshotSchema>;

/**
 * `SessionStateSnapshot` — a persisted checkpoint record.
 */
export const SessionStateSnapshotSchema = NewSessionStateSnapshotSchema.extend({
  id: z.string().uuid(),
  createdAt: z.date(),
});

export type SessionStateSnapshot = z.infer<typeof SessionStateSnapshotSchema>;
