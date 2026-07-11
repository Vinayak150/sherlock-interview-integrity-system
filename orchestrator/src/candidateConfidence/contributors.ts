import type { EvidenceEvent } from '@sherlock/contracts';

import {
  DEFAULT_HALF_LIFE_MS,
  DEFAULT_LOG_LR_CLAMP,
  clampLogLikelihoodRatio,
  decayWeight,
  signalLogLikelihoodRatio,
} from '../fusion/index.js';
import { classifyEvidenceEvent, UNSCOPED_PARTICIPANT_ID } from '../evidenceClassification/index.js';
import type { EvidenceContributor } from './types.js';

const MEANINGFUL_CONTRIBUTION_EPSILON = 1e-12;
const DEFAULT_MAX_TOP_CONTRIBUTORS = 10;

/**
 * Ranks eligible events by |decayed log-LR| for one participant's evidence
 * view, using the same decay and clamp semantics as `FusionEngine`.
 */
export function topEvidenceContributors(
  events: readonly EvidenceEvent[],
  evaluatedAt: Date,
  options: {
    readonly halfLifeMs?: number;
    readonly logLrClamp?: number;
    readonly max?: number;
    readonly participantId?: string;
  } = {},
): EvidenceContributor[] {
  const halfLifeMs = options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
  const logLrClamp = options.logLrClamp ?? DEFAULT_LOG_LR_CLAMP;
  const max = options.max ?? DEFAULT_MAX_TOP_CONTRIBUTORS;
  const participantId = options.participantId ?? UNSCOPED_PARTICIPANT_ID;

  const contributors: EvidenceContributor[] = [];

  for (const event of events) {
    if (event.healthStatus === 'SERVICE_UNAVAILABLE') {
      continue;
    }

    const rawLogLR = signalLogLikelihoodRatio(event);
    const weight = decayWeight(event.occurredAt, evaluatedAt, halfLifeMs);
    const decayedLogLikelihoodRatio = clampLogLikelihoodRatio(rawLogLR * weight, logLrClamp);

    if (Math.abs(decayedLogLikelihoodRatio) <= MEANINGFUL_CONTRIBUTION_EPSILON) {
      continue;
    }

    contributors.push({
      eventId: event.id ?? null,
      bundle: event.bundle,
      signalName: event.signalName,
      outcome: classifyEvidenceEvent(event, participantId).classification,
      decayedLogLikelihoodRatio,
      occurredAt: event.occurredAt,
    });
  }

  return [...contributors]
    .sort(
      (a, b) =>
        Math.abs(b.decayedLogLikelihoodRatio) - Math.abs(a.decayedLogLikelihoodRatio),
    )
    .slice(0, max);
}
