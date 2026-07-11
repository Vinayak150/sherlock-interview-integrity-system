import type { EvidenceEventView } from './decisionData.js';

export type SignalOutcome = 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL';

/** Approximate log-LR magnitudes for dashboard confidence-impact display (read from fusion registry). */
export const SIGNAL_LOG_LR: Readonly<Record<string, { supports: number; contradicts: number }>> = {
  display_name_match: { supports: 0.05, contradicts: -0.05 },
  email_domain_match: { supports: 0.15, contradicts: -0.15 },
  calendar_invite_match: { supports: 0.15, contradicts: -0.15 },
  face_embedding_self_consistency: { supports: 0.4, contradicts: -0.4 },
  visual_liveness: { supports: 0.05, contradicts: -0.5 },
  voice_embedding_self_consistency: { supports: 0.35, contradicts: -0.35 },
  biographical_claim_consistency: { supports: 0.1, contradicts: -0.1 },
  join_method: { supports: 0.1, contradicts: -0.1 },
  ip_geolocation_consistency: { supports: 0.05, contradicts: -0.05 },
  device_fingerprint_continuity: { supports: 0.08, contradicts: -0.08 },
  virtual_capture_device_detected: { supports: 0.01, contradicts: -0.3 },
};

export type ContradictionSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

function matchOutcome(value: unknown): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const matched = (value as { matched?: unknown }).matched;
  return typeof matched === 'boolean' ? (matched ? 'SUPPORTS' : 'CONTRADICTS') : 'NEUTRAL';
}

function presenceOutcome(value: unknown): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const available = (value as { available?: unknown }).available;
  return available === true ? 'SUPPORTS' : 'NEUTRAL';
}

function consistencyOutcome(value: unknown): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const consistent = (value as { consistent?: unknown }).consistent;
  if (consistent === true) return 'SUPPORTS';
  if (consistent === false) return 'CONTRADICTS';
  return 'NEUTRAL';
}

function detectionOutcome(value: unknown): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const detected = (value as { detected?: unknown }).detected;
  return detected === true ? 'CONTRADICTS' : 'NEUTRAL';
}

function joinMethodOutcome(value: unknown): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const method = (value as { method?: unknown }).method;
  if (method === 'direct_invite_link') return 'SUPPORTS';
  if (method === 'forwarded_link') return 'CONTRADICTS';
  return 'NEUTRAL';
}

function embeddingSelfConsistencyOutcome(value: unknown, threshold = 0.7): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const isFirst = (value as { isFirstObservation?: unknown }).isFirstObservation;
  if (isFirst === true) return 'NEUTRAL';
  const similarity = (value as { similarity?: unknown }).similarity;
  if (typeof similarity !== 'number') return 'NEUTRAL';
  return similarity >= threshold ? 'SUPPORTS' : 'CONTRADICTS';
}

function livenessOutcome(value: unknown): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const isLive = (value as { isLive?: unknown }).isLive;
  if (typeof isLive !== 'boolean') return 'NEUTRAL';
  return isLive ? 'SUPPORTS' : 'CONTRADICTS';
}

function deviceCountOutcome(value: unknown, threshold: number): SignalOutcome {
  if (typeof value !== 'object' || value === null) return 'NEUTRAL';
  const count = (value as { count?: unknown }).count;
  if (typeof count !== 'number') return 'NEUTRAL';
  return count >= threshold ? 'CONTRADICTS' : 'NEUTRAL';
}

const OUTCOME_BY_SIGNAL: Readonly<Record<string, (value: unknown) => SignalOutcome>> = {
  display_name_match: matchOutcome,
  email_domain_match: matchOutcome,
  calendar_invite_match: matchOutcome,
  reference_photo_available: presenceOutcome,
  prior_id_verification_available: presenceOutcome,
  account_history_available: presenceOutcome,
  join_method: joinMethodOutcome,
  ip_geolocation_consistency: consistencyOutcome,
  device_fingerprint_continuity: consistencyOutcome,
  virtual_capture_device_detected: detectionOutcome,
  multi_monitor_detected: detectionOutcome,
  face_embedding_self_consistency: (value) => embeddingSelfConsistencyOutcome(value, 0.7),
  visual_liveness: livenessOutcome,
  voice_embedding_self_consistency: (value) => embeddingSelfConsistencyOutcome(value, 0.7),
  biographical_claim_consistency: consistencyOutcome,
  tab_focus_change: (value) => deviceCountOutcome(value, 5),
  application_switch: (value) => deviceCountOutcome(value, 3),
  clipboard_paste: (value) => deviceCountOutcome(value, 1),
  keyboard_rhythm_anomaly: (value) => deviceCountOutcome(value, 1),
};

export function classifyEvidenceEvent(event: EvidenceEventView): SignalOutcome | 'MISSING' {
  if (event.healthStatus === 'NO_SIGNAL_DETECTED' || event.healthStatus === 'SERVICE_UNAVAILABLE') {
    return 'MISSING';
  }
  const extractor = OUTCOME_BY_SIGNAL[event.signalName];
  if (extractor === undefined) return 'NEUTRAL';
  return extractor(event.value);
}

export function estimateLogLikelihoodImpact(
  signalName: string,
  outcome: SignalOutcome,
): number | null {
  const spec = SIGNAL_LOG_LR[signalName];
  if (spec === undefined || outcome === 'NEUTRAL') return null;
  return outcome === 'SUPPORTS' ? spec.supports : spec.contradicts;
}

export function severityFromLogLikelihood(absLogLikelihood: number): ContradictionSeverity {
  if (absLogLikelihood >= 0.25) return 'HIGH';
  if (absLogLikelihood >= 0.08) return 'MEDIUM';
  return 'LOW';
}
