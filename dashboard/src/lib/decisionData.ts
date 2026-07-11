import type { LifecycleState } from '../liveBadgeLogic.js';
import {
  classifyEvidenceEvent,
  estimateLogLikelihoodImpact,
} from './signalClassification.js';

/** Dashboard-local view of SSE `Decision` payloads (dates arrive as ISO strings). */
export interface StreamDecision {
  readonly sessionId: string;
  readonly decidedAt: string;
  readonly lifecycleState: LifecycleState;
  readonly abstained: boolean;
  readonly ambiguous: boolean;
  readonly reviewerRecommendation: string;
  readonly alert: {
    readonly severity: string;
    readonly reason: string;
    readonly lifecycleState: LifecycleState;
  } | null;
  readonly elicitationTrigger: {
    readonly challengeType: string;
    readonly reason: string;
  } | null;
  readonly evidenceRef: {
    readonly capturedAt: string;
    readonly events: readonly EvidenceEventView[];
    readonly posterior: {
      readonly probability: number;
      readonly logOdds: number;
      readonly evaluatedAt: string;
      readonly rawProbability?: number;
      readonly credibleInterval: {
        readonly lower: number;
        readonly upper: number;
        readonly mass: number;
      };
      readonly bundleContributions: readonly {
        readonly bundle: string;
        readonly logOddsContribution: number;
        readonly eligibleEventCount: number;
      }[];
      readonly eligibleEventCount: number;
    };
  };
}

export interface EvidenceEventView {
  readonly id: string;
  readonly bundle: string;
  readonly signalName: string;
  readonly healthStatus: 'OK' | 'NO_SIGNAL_DETECTED' | 'SERVICE_UNAVAILABLE';
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly value: unknown;
}

export type TimelineEventType =
  | 'evidence_added'
  | 'fusion_updated'
  | 'lifecycle_changed'
  | 'decision_generated'
  | 'explanation_created';

export interface TimelineEvent {
  readonly id: string;
  readonly type: TimelineEventType;
  readonly timestamp: string;
  readonly title: string;
  readonly description: string;
  readonly evidenceLabel?: string;
  readonly classification?: 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL' | 'MISSING';
  readonly confidenceImpact?: number | null;
  readonly currentConfidence?: number | null;
}

const LIFECYCLE_STATES = new Set<string>([
  'UNKNOWN',
  'POSSIBLE_CANDIDATE',
  'LIKELY_CANDIDATE',
  'HIGHLY_CONFIDENT',
  'CONFIRMED',
  'RECOVERED',
  'LOST_CONFIDENCE',
  'DISQUALIFIED',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseEvidenceEvent(value: unknown): EvidenceEventView | null {
  if (!isRecord(value)) return null;
  const health = readString(value.healthStatus);
  if (health !== 'OK' && health !== 'NO_SIGNAL_DETECTED' && health !== 'SERVICE_UNAVAILABLE') {
    return null;
  }
  return {
    id: readString(value.id, crypto.randomUUID()),
    bundle: readString(value.bundle, 'unknown'),
    signalName: readString(value.signalName, 'unknown'),
    healthStatus: health,
    occurredAt: readString(value.occurredAt),
    recordedAt: readString(value.recordedAt),
    value: value.value,
  };
}

export function parseStreamDecision(value: unknown): StreamDecision | null {
  if (!isRecord(value)) return null;
  const lifecycleState = readString(value.lifecycleState);
  if (!LIFECYCLE_STATES.has(lifecycleState)) return null;

  const evidenceRefRaw = value.evidenceRef;
  if (!isRecord(evidenceRefRaw)) return null;
  const posteriorRaw = evidenceRefRaw.posterior;
  if (!isRecord(posteriorRaw)) return null;
  const intervalRaw = posteriorRaw.credibleInterval;
  if (!isRecord(intervalRaw)) return null;

  const eventsRaw = evidenceRefRaw.events;
  const events = Array.isArray(eventsRaw)
    ? eventsRaw
        .map(parseEvidenceEvent)
        .filter((event): event is EvidenceEventView => event !== null)
    : [];

  const contributionsRaw = posteriorRaw.bundleContributions;
  const bundleContributions = Array.isArray(contributionsRaw)
    ? contributionsRaw.filter(isRecord).map((item) => ({
        bundle: readString(item.bundle, 'unknown'),
        logOddsContribution: readNumber(item.logOddsContribution),
        eligibleEventCount: readNumber(item.eligibleEventCount),
      }))
    : [];

  const alertRaw = value.alert;
  const alert =
    alertRaw === null || alertRaw === undefined
      ? null
      : isRecord(alertRaw)
        ? {
            severity: readString(alertRaw.severity, 'INFO'),
            reason: readString(alertRaw.reason, 'Alert raised'),
            lifecycleState: LIFECYCLE_STATES.has(readString(alertRaw.lifecycleState))
              ? (readString(alertRaw.lifecycleState) as LifecycleState)
              : (lifecycleState as LifecycleState),
          }
        : null;

  const triggerRaw = value.elicitationTrigger;
  const elicitationTrigger =
    triggerRaw === null || triggerRaw === undefined
      ? null
      : isRecord(triggerRaw)
        ? {
            challengeType: readString(triggerRaw.challengeType, 'unknown'),
            reason: readString(triggerRaw.reason, ''),
          }
        : null;

  return {
    sessionId: readString(value.sessionId),
    decidedAt: readString(value.decidedAt),
    lifecycleState: lifecycleState as LifecycleState,
    abstained: readBoolean(value.abstained),
    ambiguous: readBoolean(value.ambiguous),
    reviewerRecommendation: readString(value.reviewerRecommendation, 'NONE'),
    alert,
    elicitationTrigger,
    evidenceRef: {
      capturedAt: readString(evidenceRefRaw.capturedAt),
      events,
      posterior: {
        probability: readNumber(posteriorRaw.probability),
        logOdds: readNumber(posteriorRaw.logOdds),
        evaluatedAt: readString(posteriorRaw.evaluatedAt),
        rawProbability:
          posteriorRaw.rawProbability === undefined
            ? undefined
            : readNumber(posteriorRaw.rawProbability, readNumber(posteriorRaw.probability)),
        credibleInterval: {
          lower: readNumber(intervalRaw.lower),
          upper: readNumber(intervalRaw.upper),
          mass: readNumber(intervalRaw.mass, 0.9),
        },
        bundleContributions,
        eligibleEventCount: readNumber(posteriorRaw.eligibleEventCount),
      },
    },
  };
}

export function buildTimeline(decisions: readonly StreamDecision[]): readonly TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (let index = 0; index < decisions.length; index += 1) {
    const decision = decisions[index];
    if (decision === undefined) continue;
    const previous = index > 0 ? decisions[index - 1] : undefined;
    const baseId = `${decision.decidedAt}-${index}`;
    const currentConfidence = decision.evidenceRef.posterior.probability;

    const previousEventIds = new Set((previous?.evidenceRef.events ?? []).map((event) => event.id));
    const newEvents = decision.evidenceRef.events.filter((event) => !previousEventIds.has(event.id));

    for (const [eventIndex, event] of newEvents.entries()) {
      const classification = classifyEvidenceEvent(event);
      const outcome =
        classification === 'MISSING'
          ? null
          : classification === 'SUPPORTS' || classification === 'CONTRADICTS'
            ? classification
            : 'NEUTRAL';
      const confidenceImpact =
        outcome === null ? null : estimateLogLikelihoodImpact(event.signalName, outcome);

      events.push({
        id: `${baseId}-evidence-${event.id}-${String(eventIndex)}`,
        type: 'evidence_added',
        timestamp: event.occurredAt || decision.decidedAt,
        title: 'Evidence',
        description: `${event.bundle}/${event.signalName}`,
        evidenceLabel: `${event.bundle} · ${event.signalName}`,
        classification,
        confidenceImpact,
        currentConfidence,
      });

      if (classification !== 'MISSING') {
        events.push({
          id: `${baseId}-classification-${event.id}`,
          type: 'fusion_updated',
          timestamp: event.occurredAt || decision.decidedAt,
          title: 'Classification',
          description: classification,
          classification,
          confidenceImpact,
          currentConfidence,
        });
      }

      if (confidenceImpact !== null) {
        events.push({
          id: `${baseId}-impact-${event.id}`,
          type: 'fusion_updated',
          timestamp: decision.decidedAt,
          title: 'Confidence impact',
          description: `${confidenceImpact >= 0 ? '+' : ''}${confidenceImpact.toFixed(3)} log-LR`,
          classification,
          confidenceImpact,
          currentConfidence,
        });
      }

      events.push({
        id: `${baseId}-confidence-${event.id}`,
        type: 'decision_generated',
        timestamp: decision.decidedAt,
        title: 'Current confidence',
        description: `${(currentConfidence * 100).toFixed(1)}%`,
        classification,
        confidenceImpact,
        currentConfidence,
      });
    }

    const previousEventCount = previous?.evidenceRef.events.length ?? 0;
    const newEventCount = decision.evidenceRef.events.length - previousEventCount;
    if (newEventCount > 0 && newEvents.length === 0) {
      events.push({
        id: `${baseId}-evidence-batch`,
        type: 'evidence_added',
        timestamp: decision.decidedAt,
        title: 'Evidence added',
        description: `${String(newEventCount)} signal${newEventCount === 1 ? '' : 's'} recorded`,
        currentConfidence,
      });
    }

    events.push({
      id: `${baseId}-fusion`,
      type: 'fusion_updated',
      timestamp: decision.evidenceRef.posterior.evaluatedAt || decision.decidedAt,
      title: 'Fusion updated',
      description: `Posterior probability ${(decision.evidenceRef.posterior.probability * 100).toFixed(1)}%`,
      currentConfidence,
    });

    if (previous === undefined || previous.lifecycleState !== decision.lifecycleState) {
      events.push({
        id: `${baseId}-lifecycle`,
        type: 'lifecycle_changed',
        timestamp: decision.decidedAt,
        title: 'Lifecycle changed',
        description:
          previous === undefined
            ? `Entered ${decision.lifecycleState.replaceAll('_', ' ')}`
            : `${previous.lifecycleState.replaceAll('_', ' ')} → ${decision.lifecycleState.replaceAll('_', ' ')}`,
        currentConfidence,
      });
    }

    events.push({
      id: `${baseId}-decision`,
      type: 'decision_generated',
      timestamp: decision.decidedAt,
      title: 'Decision generated',
      description: `Recommendation: ${decision.reviewerRecommendation.replaceAll('_', ' ').toLowerCase()}`,
      currentConfidence,
    });

    if (decision.alert !== null) {
      events.push({
        id: `${baseId}-explanation`,
        type: 'explanation_created',
        timestamp: decision.decidedAt,
        title: 'Explanation created',
        description: decision.alert.reason,
        currentConfidence,
      });
    }
  }

  return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export interface EvidenceBundleSummary {
  readonly key: string;
  readonly label: string;
  readonly bundles: readonly string[];
  readonly healthStatus: 'OK' | 'NO_SIGNAL_DETECTED' | 'SERVICE_UNAVAILABLE' | 'unavailable';
  readonly confidence: number | null;
  readonly lastUpdate: string | null;
  readonly eventCount: number;
}

const EVIDENCE_CATEGORIES: readonly {
  readonly key: string;
  readonly label: string;
  readonly bundles: readonly string[];
}[] = [
  { key: 'identity', label: 'Identity', bundles: ['claim'] },
  { key: 'audio', label: 'Audio', bundles: ['audio'] },
  { key: 'video', label: 'Video', bundles: ['visual'] },
  { key: 'metadata', label: 'Metadata', bundles: ['metadata'] },
  { key: 'device', label: 'Device', bundles: ['device'] },
  { key: 'language', label: 'Language', bundles: ['linguistic'] },
];

export function summarizeEvidenceBundles(
  decision: StreamDecision | null,
): readonly EvidenceBundleSummary[] {
  return EVIDENCE_CATEGORIES.map((category) => {
    if (decision === null) {
      return {
        key: category.key,
        label: category.label,
        bundles: category.bundles,
        healthStatus: 'unavailable' as const,
        confidence: null,
        lastUpdate: null,
        eventCount: 0,
      };
    }

    const events = decision.evidenceRef.events.filter((event) =>
      category.bundles.includes(event.bundle),
    );
    const contribution = decision.evidenceRef.posterior.bundleContributions.find((item) =>
      category.bundles.includes(item.bundle),
    );

    let healthStatus: EvidenceBundleSummary['healthStatus'] = 'unavailable';
    if (events.length > 0) {
      const latest = events.reduce((acc, event) =>
        new Date(event.occurredAt).getTime() > new Date(acc.occurredAt).getTime() ? event : acc,
      );
      healthStatus = latest.healthStatus;
    }

    const confidence =
      contribution !== undefined && contribution.eligibleEventCount > 0
        ? Math.min(1, Math.max(0, Math.abs(contribution.logOddsContribution) / 4))
        : null;

    const lastUpdate =
      events.length > 0
        ? events.reduce(
            (latest, event) =>
              new Date(event.occurredAt).getTime() > new Date(latest).getTime()
                ? event.occurredAt
                : latest,
            events[0]?.occurredAt ?? '',
          )
        : null;

    return {
      key: category.key,
      label: category.label,
      bundles: category.bundles,
      healthStatus,
      confidence,
      lastUpdate,
      eventCount: events.length,
    };
  });
}
