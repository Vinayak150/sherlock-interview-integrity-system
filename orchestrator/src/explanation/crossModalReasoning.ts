import type {
  ModalityIdentityAssessment,
  ParticipantCrossModalMetrics,
  SessionCrossModalMetrics,
} from '../candidateConfidence/crossModalConsistency.js';

export interface CrossModalReasoningSummary {
  readonly participantId: string | null;
  readonly modalities: readonly ModalityIdentityAssessment[];
  readonly crossModalConsistency: number;
  readonly crossModalConfidence: number;
  readonly crossModalDisagreement: number;
}

export interface BuildCrossModalReasoningInput {
  readonly crossModalMetrics?: SessionCrossModalMetrics;
  readonly topParticipantId?: string | null;
}

function selectParticipantMetrics(
  metrics: SessionCrossModalMetrics,
  topParticipantId: string | null | undefined,
): ParticipantCrossModalMetrics | null {
  if (topParticipantId !== null && topParticipantId !== undefined) {
    return metrics.byParticipant.find((row) => row.participantId === topParticipantId) ?? null;
  }
  return metrics.byParticipant[0] ?? null;
}

/**
 * Formats precomputed cross-modal metrics for the Explanation Engine.
 * Reuses `SessionCrossModalMetrics` — never recomputes modality stances.
 */
export function buildCrossModalReasoningSummary(
  input: BuildCrossModalReasoningInput,
): CrossModalReasoningSummary | null {
  if (input.crossModalMetrics === undefined) {
    return null;
  }

  const participant = selectParticipantMetrics(
    input.crossModalMetrics,
    input.topParticipantId,
  );
  if (participant === null) {
    return null;
  }

  return {
    participantId: participant.participantId,
    modalities: participant.modalities,
    crossModalConsistency: participant.crossModalConsistency,
    crossModalConfidence: participant.crossModalConfidence,
    crossModalDisagreement: participant.crossModalDisagreement,
  };
}
