import type { BundleName, EvidenceEvent } from '@sherlock/contracts';

import type { LikelihoodRatioSpec, OutcomeExtractor, SignalOutcome } from './types.js';

/**
 * The hand-set, expert-elicited likelihood-ratio registry for every Claim
 * (RFC §4-A) and Metadata (§4-B) signal built at M2 — the single seam Plan
 * §8 requires ("if Phase-1 likelihood ratios are hardcoded as literals
 * scattered through bundle logic rather than isolated as swappable
 * parameters, §5/§16's stated Phase-3 migration... becomes a rewrite
 * instead of a data-driven update"). Recalibrating from labeled outcomes
 * (§5's Phase 3+ migration path) means editing this table, not the Fusion
 * Engine.
 *
 * Every magnitude below is a Phase-1 placeholder loosely proportional to
 * this signal's qualitative reliability/predictive-power ranking in the
 * RFC's own §4 signal table — "judgment, not measurement" (§5) — and nudges
 * the posterior by design, never dominates it alone (no single one of
 * these signals crosses even a tenth of a typical decision threshold).
 */
interface RegisteredSignal {
  readonly spec: LikelihoodRatioSpec;
  readonly extractOutcome: OutcomeExtractor;
}

function assertValidSpec(signalName: string, spec: LikelihoodRatioSpec): LikelihoodRatioSpec {
  if (!(spec.supportsLogLR > 0)) {
    throw new RangeError(
      `${signalName}: supportsLogLR must be positive, received ${spec.supportsLogLR}`,
    );
  }
  if (!(spec.contradictsLogLR < 0)) {
    throw new RangeError(
      `${signalName}: contradictsLogLR must be negative, received ${spec.contradictsLogLR}`,
    );
  }
  return spec;
}

/** `EvidenceEvent.value` shapes with a boolean `matched` field (`ClaimMatchValue`). */
function matchOutcome(value: unknown): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const matched = (value as { matched?: unknown }).matched;
  return typeof matched === 'boolean' ? (matched ? 'SUPPORTS' : 'CONTRADICTS') : 'NEUTRAL';
}

/**
 * `EvidenceEvent.value` shapes with a boolean `available` field
 * (`ClaimPresenceValue`). Presence-only signals: a reference existing on
 * file strengthens the identity claim slightly; a reference *not* existing
 * is unavailability, not counter-evidence (RFC §7 absence-of-evidence
 * principle applies here too) — hence `NEUTRAL`, never `CONTRADICTS`.
 */
function presenceOutcome(value: unknown): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const available = (value as { available?: unknown }).available;
  return available === true ? 'SUPPORTS' : 'NEUTRAL';
}

/**
 * `EvidenceEvent.value` shapes with a nullable-boolean `consistent` field
 * (`MetadataConsistencyValue`). `consistent: null` (nothing to compare) is
 * `NEUTRAL`, not a mismatch.
 */
function consistencyOutcome(value: unknown): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const consistent = (value as { consistent?: unknown }).consistent;
  if (consistent === true) return 'SUPPORTS';
  if (consistent === false) return 'CONTRADICTS';
  return 'NEUTRAL';
}

/**
 * `EvidenceEvent.value` shapes with a boolean `detected` field
 * (`MetadataDetectionValue`). Both registered detection signals are
 * one-directional red flags (RFC §11: virtual camera is "moderate negative,
 * not disqualifying alone"; multi-monitor is "weak") — detection is
 * `CONTRADICTS`, non-detection is `NEUTRAL` (absence of one specific red
 * flag is not itself confirmatory identity evidence).
 */
function detectionOutcome(value: unknown): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const detected = (value as { detected?: unknown }).detected;
  return detected === true ? 'CONTRADICTS' : 'NEUTRAL';
}

/** `EvidenceEvent.value` shape for `join_method` (`JoinMethodValue`). */
function joinMethodOutcome(value: unknown): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const method = (value as { method?: unknown }).method;
  if (method === 'direct_invite_link') return 'SUPPORTS';
  if (method === 'forwarded_link') return 'CONTRADICTS';
  return 'NEUTRAL';
}

const CLAIM_SIGNALS: Readonly<Record<string, RegisteredSignal>> = {
  // "Very Low" reliability/predictive power, "High" manipulation risk (RFC §4 ranking table: "Name match").
  display_name_match: {
    spec: assertValidSpec('display_name_match', { supportsLogLR: 0.05, contradictsLogLR: -0.05 }),
    extractOutcome: matchOutcome,
  },
  // "Low" reliability/predictive power (RFC §4 ranking table: "Email/calendar match").
  email_domain_match: {
    spec: assertValidSpec('email_domain_match', { supportsLogLR: 0.15, contradictsLogLR: -0.15 }),
    extractOutcome: matchOutcome,
  },
  calendar_invite_match: {
    spec: assertValidSpec('calendar_invite_match', {
      supportsLogLR: 0.15,
      contradictsLogLR: -0.15,
    }),
    extractOutcome: matchOutcome,
  },
  // Presence-only: strengthens the pre-call claim's overall quality (§5: "O_0... from pre-call
  // identity-claim strength"); a completed prior ID verification is the strongest of the three.
  reference_photo_available: {
    spec: assertValidSpec('reference_photo_available', {
      supportsLogLR: 0.05,
      contradictsLogLR: -0.01,
    }),
    extractOutcome: presenceOutcome,
  },
  prior_id_verification_available: {
    spec: assertValidSpec('prior_id_verification_available', {
      supportsLogLR: 0.2,
      contradictsLogLR: -0.01,
    }),
    extractOutcome: presenceOutcome,
  },
  account_history_available: {
    spec: assertValidSpec('account_history_available', {
      supportsLogLR: 0.1,
      contradictsLogLR: -0.01,
    }),
    extractOutcome: presenceOutcome,
  },
};

const METADATA_SIGNALS: Readonly<Record<string, RegisteredSignal>> = {
  // RFC §4-B: "Join order and method (correct invite link vs. forwarded)."
  join_method: {
    spec: assertValidSpec('join_method', { supportsLogLR: 0.1, contradictsLogLR: -0.1 }),
    extractOutcome: joinMethodOutcome,
  },
  // RFC §4-B, explicitly "weak — VPNs are common."
  ip_geolocation_consistency: {
    spec: assertValidSpec('ip_geolocation_consistency', {
      supportsLogLR: 0.05,
      contradictsLogLR: -0.05,
    }),
    extractOutcome: consistencyOutcome,
  },
  // RFC §4-B, "weak"; slightly less spoofable than raw IP geolocation.
  device_fingerprint_continuity: {
    spec: assertValidSpec('device_fingerprint_continuity', {
      supportsLogLR: 0.08,
      contradictsLogLR: -0.08,
    }),
    extractOutcome: consistencyOutcome,
  },
  // RFC §4 ranking table: "Virtual-camera detection" — "Med predictive power," §11: "Moderate
  // negative, not disqualifying alone."
  virtual_capture_device_detected: {
    spec: assertValidSpec('virtual_capture_device_detected', {
      supportsLogLR: 0.01,
      contradictsLogLR: -0.3,
    }),
    extractOutcome: detectionOutcome,
  },
  // RFC §4-B, "weak."
  multi_monitor_detected: {
    spec: assertValidSpec('multi_monitor_detected', {
      supportsLogLR: 0.01,
      contradictsLogLR: -0.05,
    }),
    extractOutcome: detectionOutcome,
  },
  // `screen_share_state` is deliberately unregistered: the RFC's §4 ranking table gives it no
  // identity predictive-power rating at all (unlike virtual-camera detection, which it does
  // rank), and ADR-16 keeps "assistance"-flavored signals structurally separate from identity
  // confidence. It is still captured by the Metadata Bundle Adapter (M2) for future correlation/
  // explanation use — just contributes zero to this score, by design, not by omission.
};

/** `EvidenceEvent.value` shapes with a nullable `similarity` field (`EmbeddingSelfConsistencyValue`). `similarity: null` (first observation, nothing to compare) is `NEUTRAL`, never a mismatch. */
function embeddingSelfConsistencyOutcome(value: unknown, matchThreshold: number): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const similarity = (value as { similarity?: unknown }).similarity;
  if (typeof similarity !== 'number') return 'NEUTRAL';
  return similarity >= matchThreshold ? 'SUPPORTS' : 'CONTRADICTS';
}

/** `EvidenceEvent.value` shape for `visual_liveness` (`VisualLivenessValue`). */
function livenessOutcome(value: unknown): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const isLive = (value as { isLive?: unknown }).isLive;
  if (typeof isLive !== 'boolean') return 'NEUTRAL';
  return isLive ? 'SUPPORTS' : 'CONTRADICTS';
}

const VISUAL_SIGNALS: Readonly<Record<string, RegisteredSignal>> = {
  // RFC §4 ranking table: "High" reliability, "High" predictive power, "strong,
  // reference-independent" (§4-C) -- the strongest single signal registered so far.
  face_embedding_self_consistency: {
    spec: assertValidSpec('face_embedding_self_consistency', {
      supportsLogLR: 0.4,
      contradictsLogLR: -0.4,
    }),
    extractOutcome: (value) => embeddingSelfConsistencyOutcome(value, 0.7),
  },
  // RFC §15 threat model: liveness is the primary mitigation for spoofing; a failed liveness
  // check is a meaningfully severe red flag, asymmetric to a passed one (which just confirms
  // the absence of that specific attack, not identity per se).
  visual_liveness: {
    spec: assertValidSpec('visual_liveness', { supportsLogLR: 0.05, contradictsLogLR: -0.5 }),
    extractOutcome: livenessOutcome,
  },
  // face_embedding_change_point is deliberately unregistered (like `screen_share_state`, M3):
  // a change-point's entire causal effect on the system flows through the
  // `ContradictionSignal` -> `DISQUALIFIED` path (statemachine/lifecycle.ts), never through
  // the ordinary log-odds sum -- registering an additional log-LR here would double-count the
  // same fact both ways.
};

const AUDIO_SIGNALS: Readonly<Record<string, RegisteredSignal>> = {
  // RFC §4 ranking table: "High" reliability, "High" predictive power (§4-D), the audio analog
  // of face-embedding self-consistency.
  voice_embedding_self_consistency: {
    spec: assertValidSpec('voice_embedding_self_consistency', {
      supportsLogLR: 0.35,
      contradictsLogLR: -0.35,
    }),
    extractOutcome: (value) => embeddingSelfConsistencyOutcome(value, 0.7),
  },
  // voice_embedding_change_point is deliberately unregistered -- see visual bundle above.
};

/**
 * `EvidenceEvent.value` shape for the Device/OS bundle's counted signals
 * (`DeviceEventCountValue`). Any count at or above `threshold` within the
 * window is treated as `CONTRADICTS` (a session with unusually heavy tab/
 * app-switching, clipboard pasting, or keyboard-rhythm anomalies is,
 * per RFC §4-F's scope note, weak evidence for "external resource use" —
 * a different question than identity, hence the near-zero magnitude this
 * still gets in `DEVICE_SIGNALS` below). Anything under the threshold is
 * `NEUTRAL`, never `SUPPORTS` — an *absence* of heavy device activity says
 * nothing positive about identity either.
 */
function deviceCountOutcome(value: unknown, threshold: number): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const count = (value as { count?: unknown }).count;
  if (typeof count !== 'number') return 'NEUTRAL';
  return count >= threshold ? 'CONTRADICTS' : 'NEUTRAL';
}

/**
 * ADR-16: "Device/OS signals (Bundle F) are weighted near-zero for
 * identity, kept as a separate parallel track for assistance-integrity."
 * The RFC's own "more accurate model" (a genuine parallel
 * assistance-integrity fusion track reusing this same machinery) is
 * explicitly "noted, not built out here" by the RFC itself (§4's scope
 * note) — so it is not built out here either. Every magnitude below is
 * deliberately an order of magnitude smaller than even the weakest
 * Claim/Metadata signal (M2/M3), so heavy device activity can never
 * meaningfully move the identity score, only appear in the evidence
 * report (M6) for a human reviewer's own judgment.
 */
const DEVICE_SIGNALS: Readonly<Record<string, RegisteredSignal>> = {
  tab_focus_change: {
    spec: assertValidSpec('tab_focus_change', { supportsLogLR: 0.001, contradictsLogLR: -0.01 }),
    extractOutcome: (value) => deviceCountOutcome(value, 5),
  },
  application_switch: {
    spec: assertValidSpec('application_switch', { supportsLogLR: 0.001, contradictsLogLR: -0.01 }),
    extractOutcome: (value) => deviceCountOutcome(value, 3),
  },
  clipboard_paste: {
    spec: assertValidSpec('clipboard_paste', { supportsLogLR: 0.001, contradictsLogLR: -0.015 }),
    extractOutcome: (value) => deviceCountOutcome(value, 1),
  },
  keyboard_rhythm_anomaly: {
    spec: assertValidSpec('keyboard_rhythm_anomaly', {
      supportsLogLR: 0.001,
      contradictsLogLR: -0.015,
    }),
    extractOutcome: (value) => deviceCountOutcome(value, 1),
  },
};

/** `EvidenceEvent.value` shape for `biographical_claim_consistency` (`BiographicalClaimConsistencyValue`). */
function biographicalConsistencyOutcome(value: unknown): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const consistent = (value as { consistent?: unknown }).consistent;
  if (consistent === true) return 'SUPPORTS';
  if (consistent === false) return 'CONTRADICTS';
  return 'NEUTRAL';
}

const LINGUISTIC_SIGNALS: Readonly<Record<string, RegisteredSignal>> = {
  // RFC §3: "Weak-causal for 'same person throughout,' confounded by nerves and fatigue" --
  // deliberately modest, well below the embedding self-consistency signals.
  biographical_claim_consistency: {
    spec: assertValidSpec('biographical_claim_consistency', {
      supportsLogLR: 0.1,
      contradictsLogLR: -0.15,
    }),
    extractOutcome: biographicalConsistencyOutcome,
  },
};

/** `EvidenceEvent.value` shape for `active_elicitation_response` (`ElicitationResponseValue`). `satisfied: null` (no response captured, e.g. a timeout) is `NEUTRAL`, never treated as a failed challenge. */
function elicitationOutcome(value: unknown): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const satisfied = (value as { satisfied?: unknown }).satisfied;
  if (satisfied === true) return 'SUPPORTS';
  if (satisfied === false) return 'CONTRADICTS';
  return 'NEUTRAL';
}

const ELICITATION_SIGNALS: Readonly<Record<string, RegisteredSignal>> = {
  // RFC §4 ranking table: "Active-elicitation response" -- "High" reliability, "High"
  // predictive power, "Low by design" manipulation risk -- one of the strongest signals in
  // the whole registry, by design (RFC §3/§15: functions like a cryptographic nonce against
  // replay attacks).
  active_elicitation_response: {
    spec: assertValidSpec('active_elicitation_response', {
      supportsLogLR: 0.3,
      contradictsLogLR: -0.45,
    }),
    extractOutcome: elicitationOutcome,
  },
};

const REGISTRY: Readonly<
  Record<BundleName, Readonly<Record<string, RegisteredSignal>> | undefined>
> = {
  claim: CLAIM_SIGNALS,
  metadata: METADATA_SIGNALS,
  visual: VISUAL_SIGNALS,
  audio: AUDIO_SIGNALS,
  linguistic: LINGUISTIC_SIGNALS,
  device: DEVICE_SIGNALS,
  elicitation: ELICITATION_SIGNALS,
  meta: undefined,
  cross_session: undefined,
};

/**
 * Resolves a persisted evidence event's outcome, honoring the signal-health
 * contract (§13, ADR-11) before ever looking at the payload:
 *
 * - `SERVICE_UNAVAILABLE` must be filtered out by the caller before this is
 *   reached (`FusionEngine` does so) — calling this with one is a
 *   programming error, since "excluded from evidence entirely" (§13) means
 *   exactly that.
 * - `NO_SIGNAL_DETECTED` always resolves to `NEUTRAL`, regardless of the
 *   payload shape — this is the guard against the bug class where a
 *   bundle adapter's "nothing to compare" placeholder value (e.g.
 *   `matched: false` with null operands) would otherwise be misread as a
 *   genuine contradiction.
 * - `OK` resolves via the registered extractor for `(bundle, signalName)`,
 *   or `NEUTRAL` if nothing is registered yet (a future bundle's signal
 *   reaching this engine before it has a likelihood-ratio entry must never
 *   throw or silently corrupt the sum).
 */
export function resolveSignalOutcome(
  event: Pick<EvidenceEvent, 'bundle' | 'signalName' | 'healthStatus' | 'value'>,
): SignalOutcome {
  if (event.healthStatus === 'SERVICE_UNAVAILABLE') {
    throw new Error(
      `resolveSignalOutcome called with a SERVICE_UNAVAILABLE event ("${event.signalName}") — ` +
        'these must be excluded before reaching the Fusion Engine (RFC §13).',
    );
  }
  if (event.healthStatus === 'NO_SIGNAL_DETECTED') {
    return 'NEUTRAL';
  }

  const registered = REGISTRY[event.bundle]?.[event.signalName];
  return registered === undefined ? 'NEUTRAL' : registered.extractOutcome(event.value);
}

/**
 * The signed, undecayed log-likelihood-ratio magnitude for one event —
 * `resolveSignalOutcome`'s direction, scaled by that signal's registered
 * magnitude (0 for `NEUTRAL`, or for any signal without a registered
 * spec).
 */
export function signalLogLikelihoodRatio(
  event: Pick<EvidenceEvent, 'bundle' | 'signalName' | 'healthStatus' | 'value'>,
): number {
  const outcome = resolveSignalOutcome(event);
  if (outcome === 'NEUTRAL') return 0;

  const registered = REGISTRY[event.bundle]?.[event.signalName];
  if (registered === undefined) return 0;

  return outcome === 'SUPPORTS' ? registered.spec.supportsLogLR : registered.spec.contradictsLogLR;
}
