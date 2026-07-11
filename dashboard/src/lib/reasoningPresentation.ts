import type { EvidenceEventView, StreamDecision } from './decisionData.js';
import {
  classifyEvidenceEvent,
  estimateLogLikelihoodImpact,
  severityFromLogLikelihood,
  type ContradictionSeverity,
  type SignalOutcome,
} from './signalClassification.js';

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface AiEvidenceSummaryView {
  readonly confidence: number;
  readonly rawConfidence: number | null;
  readonly calibratedConfidence: number | null;
  readonly uncertainty: number;
  readonly recommendation: string;
  readonly band: ConfidenceBand;
}

export type ModalityStance = 'ALIGNED' | 'CONTRADICTING' | 'UNKNOWN';

export interface CrossModalModalityView {
  readonly modality: 'Face' | 'Voice' | 'Metadata' | 'Transcript';
  readonly stance: ModalityStance;
  readonly signalName: string | null;
  readonly bundle: string | null;
}

export interface CrossModalConsistencyView {
  readonly modalities: readonly CrossModalModalityView[];
  readonly overallConsistency: number | null;
  readonly overallDisagreement: number | null;
}

export interface ContradictionItemView {
  readonly id: string;
  readonly severity: ContradictionSeverity;
  readonly bundle: string;
  readonly signalName: string;
  readonly timestamp: string;
  readonly participant: string;
  readonly confidenceImpact: number | null;
}

export interface ExplanationSectionView {
  readonly executiveSummary: string;
  readonly reasoning: readonly string[];
  readonly recommendation: string;
  readonly supportingEvidence: readonly EvidenceEventView[];
  readonly conflictingEvidence: readonly EvidenceEventView[];
  readonly missingEvidence: readonly EvidenceEventView[];
}

export interface SessionDiagnosticsView {
  readonly inferenceLatencyMs: readonly { label: string; value: number }[];
  readonly modelVersions: readonly { label: string; value: string }[];
  readonly observabilityMetrics: readonly { label: string; value: string }[];
}

const FACE_SIGNALS = new Set(['face_embedding_self_consistency', 'visual_liveness']);
const SPEAKER_SIGNALS = new Set(['voice_embedding_self_consistency']);
const METADATA_SIGNALS = new Set([
  'display_name_match',
  'email_domain_match',
  'calendar_invite_match',
  'join_method',
  'ip_geolocation_consistency',
  'device_fingerprint_continuity',
  'virtual_capture_device_detected',
  'multi_monitor_detected',
]);
const TRANSCRIPT_SIGNALS = new Set(['biographical_claim_consistency']);

export function confidenceBand(probability: number): ConfidenceBand {
  if (probability >= 0.75) return 'high';
  if (probability >= 0.45) return 'medium';
  return 'low';
}

export function buildAiEvidenceSummary(decision: StreamDecision | null): AiEvidenceSummaryView | null {
  if (decision === null) return null;
  const { posterior } = decision.evidenceRef;
  const hasRaw = posterior.rawProbability !== undefined;
  const rawValue = hasRaw ? posterior.rawProbability! : null;
  const showsCalibration =
    hasRaw && posterior.rawProbability !== posterior.probability;

  return {
    confidence: posterior.probability,
    rawConfidence: rawValue,
    calibratedConfidence: showsCalibration ? posterior.probability : null,
    uncertainty: posterior.credibleInterval.upper - posterior.credibleInterval.lower,
    recommendation: decision.reviewerRecommendation.replaceAll('_', ' ').toLowerCase(),
    band: confidenceBand(posterior.probability),
  };
}

function latestEvent(
  events: readonly EvidenceEventView[],
  predicate: (event: EvidenceEventView) => boolean,
): EvidenceEventView | null {
  let latest: EvidenceEventView | null = null;
  for (const event of events) {
    if (!predicate(event)) continue;
    if (
      latest === null ||
      new Date(event.occurredAt).getTime() > new Date(latest.occurredAt).getTime()
    ) {
      latest = event;
    }
  }
  return latest;
}

function outcomeToStance(outcome: SignalOutcome | 'MISSING'): ModalityStance {
  if (outcome === 'SUPPORTS') return 'ALIGNED';
  if (outcome === 'CONTRADICTS') return 'CONTRADICTING';
  return 'UNKNOWN';
}

function buildModalityView(
  label: CrossModalModalityView['modality'],
  event: EvidenceEventView | null,
): CrossModalModalityView {
  if (event === null) {
    return { modality: label, stance: 'UNKNOWN', signalName: null, bundle: null };
  }
  return {
    modality: label,
    stance: outcomeToStance(classifyEvidenceEvent(event)),
    signalName: event.signalName,
    bundle: event.bundle,
  };
}

export function buildCrossModalConsistencyView(
  decision: StreamDecision | null,
): CrossModalConsistencyView | null {
  if (decision === null) return null;
  const events = decision.evidenceRef.events;

  const modalities = [
    buildModalityView(
      'Face',
      latestEvent(events, (event) => FACE_SIGNALS.has(event.signalName)),
    ),
    buildModalityView(
      'Voice',
      latestEvent(events, (event) => SPEAKER_SIGNALS.has(event.signalName)),
    ),
    buildModalityView(
      'Metadata',
      latestEvent(events, (event) => METADATA_SIGNALS.has(event.signalName)),
    ),
    buildModalityView(
      'Transcript',
      latestEvent(events, (event) => TRANSCRIPT_SIGNALS.has(event.signalName)),
    ),
  ];

  const scored = modalities.filter((row) => row.stance !== 'UNKNOWN');
  if (scored.length === 0) {
    return { modalities, overallConsistency: null, overallDisagreement: null };
  }

  const aligned = scored.filter((row) => row.stance === 'ALIGNED').length;
  const contradicting = scored.filter((row) => row.stance === 'CONTRADICTING').length;
  const total = scored.length;

  return {
    modalities,
    overallConsistency: aligned / total,
    overallDisagreement: contradicting / total,
  };
}

export function buildContradictionItems(
  decision: StreamDecision | null,
): readonly ContradictionItemView[] {
  if (decision === null) return [];

  const items: ContradictionItemView[] = [];
  for (const event of decision.evidenceRef.events) {
    const outcome = classifyEvidenceEvent(event);
    if (outcome !== 'CONTRADICTS') continue;
    const impact = estimateLogLikelihoodImpact(event.signalName, outcome);
    const absImpact = impact === null ? 0 : Math.abs(impact);
    items.push({
      id: event.id,
      severity: severityFromLogLikelihood(absImpact),
      bundle: event.bundle,
      signalName: event.signalName,
      timestamp: event.occurredAt,
      participant: 'Selected candidate',
      confidenceImpact: impact,
    });
  }

  const order: Record<ContradictionSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return items.sort((a, b) => {
    const bySeverity = order[a.severity] - order[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
}

export function buildExplanationView(decision: StreamDecision | null): ExplanationSectionView | null {
  if (decision === null) return null;

  const events = decision.evidenceRef.events;
  const supporting: EvidenceEventView[] = [];
  const conflicting: EvidenceEventView[] = [];
  const missing: EvidenceEventView[] = [];

  for (const event of events) {
    const outcome = classifyEvidenceEvent(event);
    if (outcome === 'MISSING') {
      missing.push(event);
    } else if (outcome === 'SUPPORTS') {
      supporting.push(event);
    } else if (outcome === 'CONTRADICTS') {
      conflicting.push(event);
    }
  }

  const posterior = decision.evidenceRef.posterior;
  const uncertainty = posterior.credibleInterval.upper - posterior.credibleInterval.lower;
  const executiveSummary = [
    `Lifecycle state is ${decision.lifecycleState.replaceAll('_', ' ').toLowerCase()}.`,
    `Confidence is ${(posterior.probability * 100).toFixed(1)}% with a ${(uncertainty * 100).toFixed(1)} point credible-interval width.`,
    decision.alert !== null ? `Alert: ${decision.alert.reason}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join(' ');

  const reasoning = posterior.bundleContributions
    .filter((row) => row.eligibleEventCount > 0)
    .sort((a, b) => Math.abs(b.logOddsContribution) - Math.abs(a.logOddsContribution))
    .slice(0, 5)
    .map(
      (row) =>
        `${row.bundle}: ${row.logOddsContribution >= 0 ? '+' : ''}${row.logOddsContribution.toFixed(3)} log-odds (${String(row.eligibleEventCount)} event${row.eligibleEventCount === 1 ? '' : 's'})`,
    );

  return {
    executiveSummary,
    reasoning,
    recommendation: decision.reviewerRecommendation.replaceAll('_', ' ').toLowerCase(),
    supportingEvidence: supporting,
    conflictingEvidence: conflicting,
    missingEvidence: missing,
  };
}

function readNumericField(value: unknown, key: string): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function readStringField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

export function buildSessionDiagnostics(
  decision: StreamDecision | null,
): SessionDiagnosticsView | null {
  if (decision === null) return null;

  const latency: { label: string; value: number }[] = [];
  const versions: { label: string; value: string }[] = [];
  const metrics: { label: string; value: string }[] = [];

  for (const event of decision.evidenceRef.events) {
    const value = event.value;
    const inferenceLatency =
      readNumericField(value, 'inferenceLatency') ?? readNumericField(value, 'inference_latency');
    if (inferenceLatency !== null) {
      latency.push({ label: `${event.bundle}/${event.signalName}`, value: inferenceLatency });
    }

    for (const key of ['faceModel', 'face_model', 'voiceBackend', 'voice_backend', 'modelVersion', 'model_version']) {
      const version = readStringField(value, key);
      if (version !== null) {
        versions.push({ label: key.replaceAll('_', ' '), value: version });
      }
    }

    const metricName = readStringField(value, 'metricName') ?? readStringField(value, 'metric_name');
    const metricValue = readStringField(value, 'metricValue') ?? readStringField(value, 'metric_value');
    if (metricName !== null && metricValue !== null) {
      metrics.push({ label: metricName, value: metricValue });
    }
  }

  if (latency.length === 0 && versions.length === 0 && metrics.length === 0) {
    return null;
  }

  return {
    inferenceLatencyMs: latency,
    modelVersions: versions,
    observabilityMetrics: metrics,
  };
}

export const MODEL_STACK_INFO: readonly { readonly label: string; readonly detail: string }[] = [
  { label: 'Face Recognition', detail: 'InsightFace (buffalo_l) — CPU embeddings' },
  { label: 'Speaker Recognition', detail: 'Pyannote → SpeechBrain fallback' },
  { label: 'Anti-Spoofing', detail: 'MiniFASNet / SilentFace / heuristic chain' },
  { label: 'Candidate Confidence Engine', detail: 'Internal ranked hypothesis selection' },
  { label: 'Confidence Calibration', detail: 'Optional Platt / isotonic post-fusion layer' },
  { label: 'LLMProvider', detail: 'StubLLMProvider (default, deterministic)' },
];
