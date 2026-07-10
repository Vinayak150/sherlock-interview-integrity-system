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
 * Deliberately NOT introduced yet (out of scope for M1/M2, arrives with the
 * milestones that need them): the eight-state `LifecycleState` enum (M4),
 * the `EvidenceReport` shape (M6), and the visual/audio/linguistic/device/
 * elicitation/meta/cross-session bundle payload schemas (M9/M10/M11).
 * `EvidenceEvent.value` itself stays generic (`unknown`, JSON-serializable)
 * so the persistence layer (M1) never has to be revisited when a bundle's
 * payload shape changes — the schemas below are additive, describing what a
 * *conforming* claim/metadata payload looks like, not a persistence-layer
 * constraint.
 *
 * M2 scope (`docs/IMPLEMENTATION_PLAN.md`, Milestone M2 — "Claim & Metadata
 * bundle adapters + cold-start FSM") adds the payload schemas for the two
 * bundle families that milestone's adapters emit: Claim (RFC §4-A) and
 * Metadata (RFC §4-B). Both are zero-ML, deterministic comparisons — no
 * embeddings, no classifiers — consistent with that milestone's "first
 * vertical slice with zero ML dependency" objective.
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

/**
 * Claim bundle (RFC §4-A) — pre-call identity-claim signals. All three are
 * framed by the RFC as identity *claims*, not proof (§3): "near-zero cost
 * to falsify," individually weak, useful only in combination with every
 * other bundle (§5). Presence-only signals (a reference photo/ID artifact/
 * account-history record existing on file at all) are a separate signal
 * shape from the three that compare an *observed* value against the
 * *claimed* one.
 */
export const CLAIM_SIGNAL_NAMES = [
  'display_name_match',
  'email_domain_match',
  'calendar_invite_match',
  'reference_photo_available',
  'prior_id_verification_available',
  'account_history_available',
] as const;

export const ClaimSignalNameSchema = z.enum(CLAIM_SIGNAL_NAMES);

export type ClaimSignalName = z.infer<typeof ClaimSignalNameSchema>;

/**
 * `EvidenceEvent.value` shape for `display_name_match` / `email_domain_match`
 * / `calendar_invite_match`. `observedValue`/`claimedValue` are carried
 * alongside the boolean so the Explanation Engine (§8, M6) can later cite
 * *what* was compared, not just the outcome — the RFC requires every
 * Evidence Report to show its work, not just a verdict.
 */
export const ClaimMatchValueSchema = z.object({
  matched: z.boolean(),
  observedValue: z.string().trim().min(1).nullable(),
  claimedValue: z.string().trim().min(1).nullable(),
});

export type ClaimMatchValue = z.infer<typeof ClaimMatchValueSchema>;

/**
 * `EvidenceEvent.value` shape for the three claim signals that are presence
 * checks rather than comparisons (RFC §4-A: reference photo, prior
 * ID-verification artifact, account/device history — each either exists on
 * file or it doesn't).
 */
export const ClaimPresenceValueSchema = z.object({
  available: z.boolean(),
  reference: z.string().trim().min(1).nullable(),
});

export type ClaimPresenceValue = z.infer<typeof ClaimPresenceValueSchema>;

/**
 * Metadata bundle (RFC §4-B) — session/platform metadata signals. Every one
 * of these is explicitly ranked "weak" or "informational, not automatically
 * negative" in the RFC's own signal table (§4) — this bundle is Tier 2
 * (supportive, §13), never a standalone trigger.
 */
export const METADATA_SIGNAL_NAMES = [
  'join_method',
  'ip_geolocation_consistency',
  'device_fingerprint_continuity',
  'virtual_capture_device_detected',
  'screen_share_state',
  'multi_monitor_detected',
] as const;

export const MetadataSignalNameSchema = z.enum(METADATA_SIGNAL_NAMES);

export type MetadataSignalName = z.infer<typeof MetadataSignalNameSchema>;

/**
 * RFC §4-B: "Join order and method (correct invite link vs. forwarded)."
 * `joinOrder` is the participant's ordinal position among this session's
 * joiners; `null` when it could not be determined.
 */
export const JOIN_METHODS = ['direct_invite_link', 'forwarded_link', 'unknown'] as const;

export const JoinMethodSchema = z.enum(JOIN_METHODS);

export type JoinMethod = z.infer<typeof JoinMethodSchema>;

export const JoinMethodValueSchema = z.object({
  method: JoinMethodSchema,
  joinOrder: z.number().int().nonnegative().nullable(),
});

export type JoinMethodValue = z.infer<typeof JoinMethodValueSchema>;

/**
 * Reused for the two §4-B signals that compare an observed value against a
 * stated/prior one, both explicitly called out as weak: IP geolocation vs.
 * stated location ("VPNs are common"), and device/browser fingerprint
 * continuity across sessions. `consistent` is `null` — not `false` — when
 * there is nothing on record to compare against (RFC §7: absence of
 * evidence must never be coerced into evidence of absence).
 */
export const MetadataConsistencyValueSchema = z.object({
  consistent: z.boolean().nullable(),
  observedValue: z.string().trim().min(1).nullable(),
  statedValue: z.string().trim().min(1).nullable(),
});

export type MetadataConsistencyValue = z.infer<typeof MetadataConsistencyValueSchema>;

/**
 * Reused for the two §4-B signals that are simple boolean detections:
 * virtual camera/microphone driver detection, multi-monitor detection.
 */
export const MetadataDetectionValueSchema = z.object({
  detected: z.boolean(),
});

export type MetadataDetectionValue = z.infer<typeof MetadataDetectionValueSchema>;

/** RFC §4-B: "screen-share state" — informational, not itself a match/mismatch. */
export const SCREEN_SHARE_STATES = [
  'not_sharing',
  'sharing_screen',
  'sharing_application',
] as const;

export const ScreenShareStateSchema = z.enum(SCREEN_SHARE_STATES);

export type ScreenShareState = z.infer<typeof ScreenShareStateSchema>;

export const ScreenShareStateValueSchema = z.object({
  state: ScreenShareStateSchema,
});

export type ScreenShareStateValue = z.infer<typeof ScreenShareStateValueSchema>;

/**
 * Visual bundle (RFC §4-C) — face-embedding self-consistency ("strong,
 * reference-independent"), visual liveness/anti-spoof, and the
 * change-point signal RFC §5's CUSUM layer produces on this bundle's
 * embedding stream (Plan M9).
 */
export const VISUAL_SIGNAL_NAMES = [
  'face_embedding_self_consistency',
  'visual_liveness',
  'face_embedding_change_point',
] as const;

export const VisualSignalNameSchema = z.enum(VISUAL_SIGNAL_NAMES);

export type VisualSignalName = z.infer<typeof VisualSignalNameSchema>;

/** Shared by `face_embedding_self_consistency` and (via `AudioSelfConsistencyValueSchema`) the audio analog: `similarity` is `null` on the very first observation for a session, when there is no running reference yet to compare against (RFC §7 absence-of-evidence). */
export const EmbeddingSelfConsistencyValueSchema = z.object({
  similarity: z.number().min(-1).max(1).nullable(),
  isFirstObservation: z.boolean(),
});

export type EmbeddingSelfConsistencyValue = z.infer<typeof EmbeddingSelfConsistencyValueSchema>;

export const VisualLivenessValueSchema = z.object({
  score: z.number().min(0).max(1),
  isLive: z.boolean(),
});

export type VisualLivenessValue = z.infer<typeof VisualLivenessValueSchema>;

/** RFC §5's CUSUM/change-point layer output, attached to the bundle whose embedding stream it monitors (ADR-5: never decays in the ledger once flagged). */
export const ChangePointValueSchema = z.object({
  detected: z.boolean(),
  cumulativeDeviation: z.number().nonnegative(),
});

export type ChangePointValue = z.infer<typeof ChangePointValueSchema>;

/** Audio bundle (RFC §4-D) — voice-embedding self-consistency, the audio analog of the visual bundle's. */
export const AUDIO_SIGNAL_NAMES = [
  'voice_embedding_self_consistency',
  'voice_embedding_change_point',
] as const;

export const AudioSignalNameSchema = z.enum(AUDIO_SIGNAL_NAMES);

export type AudioSignalName = z.infer<typeof AudioSignalNameSchema>;

/**
 * Device/OS bundle (RFC §4-F, Bundle F) — client-agent-derived behavioral
 * signals (Plan M10). ADR-16: weighted near-zero for identity, kept on a
 * structurally separate track; never folded into the identity score.
 */
export const DEVICE_SIGNAL_NAMES = [
  'tab_focus_change',
  'application_switch',
  'clipboard_paste',
  'keyboard_rhythm_anomaly',
] as const;

export const DeviceSignalNameSchema = z.enum(DEVICE_SIGNAL_NAMES);

export type DeviceSignalName = z.infer<typeof DeviceSignalNameSchema>;

/** Generic counted-event-in-window shape shared by every Device/OS signal (RFC §9.5: "clipboard, active-tab/app-focus, keyboard-timing metadata, not keystroke *content*"). */
export const DeviceEventCountValueSchema = z.object({
  count: z.number().int().nonnegative(),
  windowMs: z.number().int().positive(),
});

export type DeviceEventCountValue = z.infer<typeof DeviceEventCountValueSchema>;

/**
 * Linguistic bundle (RFC §4-E) — "identity-consistency only... self-
 * consistency of biographical claims against the filed application."
 * Explicitly excludes answer quality/competence signals (scope boundary,
 * correction #4).
 */
export const LINGUISTIC_SIGNAL_NAMES = ['biographical_claim_consistency'] as const;

export const LinguisticSignalNameSchema = z.enum(LINGUISTIC_SIGNAL_NAMES);

export type LinguisticSignalName = z.infer<typeof LinguisticSignalNameSchema>;

export const BiographicalClaimConsistencyValueSchema = z.object({
  consistent: z.boolean().nullable(),
  claimTopic: z.string().trim().min(1),
});

export type BiographicalClaimConsistencyValue = z.infer<
  typeof BiographicalClaimConsistencyValueSchema
>;

/**
 * Active-elicitation bundle (RFC §4-G) — "Interviewer-delivered,
 * system-suggested prompts triggered specifically at borderline
 * confidence... a spontaneous unscripted statement, a brief camera
 * reposition, repeating a freshly-generated phrase." (Plan M11)
 */
export const ELICITATION_SIGNAL_NAMES = ['active_elicitation_response'] as const;

export const ElicitationSignalNameSchema = z.enum(ELICITATION_SIGNAL_NAMES);

export type ElicitationSignalName = z.infer<typeof ElicitationSignalNameSchema>;

export const ELICITATION_CHALLENGE_TYPES = [
  'unscripted_statement',
  'camera_reposition',
  'repeat_phrase',
] as const;

export const ElicitationChallengeTypeSchema = z.enum(ELICITATION_CHALLENGE_TYPES);

export type ElicitationChallengeType = z.infer<typeof ElicitationChallengeTypeSchema>;

export const ElicitationResponseValueSchema = z.object({
  challengeType: ElicitationChallengeTypeSchema,
  satisfied: z.boolean().nullable(),
});

export type ElicitationResponseValue = z.infer<typeof ElicitationResponseValueSchema>;
