import {
  AUDIO_SIGNAL_NAMES,
  CLAIM_SIGNAL_NAMES,
  DEVICE_SIGNAL_NAMES,
  ELICITATION_SIGNAL_NAMES,
  LINGUISTIC_SIGNAL_NAMES,
  METADATA_SIGNAL_NAMES,
  VISUAL_SIGNAL_NAMES,
} from '@sherlock/contracts';

import type { EvidenceReport } from './types.js';

/**
 * The validate-and-reject loop's core check (RFC §8: "the narrative may
 * only reference facts present in the structured object, and generated
 * output is validated against it before display — any signal name
 * mentioned that isn't in the source object is rejected and
 * regenerated"; RFC §15: this is the structural enforcement mechanism for
 * prompt-injection mitigation — "the LLM has no channel back into the
 * score or the state, only into the phrasing of facts it did not
 * generate").
 *
 * Every known signal name across every bundle family is the vocabulary
 * scanned for; a narrative is invalid if it mentions any signal name from
 * that vocabulary that is *not* actually present in this specific
 * report's `topContributingSignals`/`contradictoryEvidence`/
 * `missingEvidence`. Mentioning something that is not a recognized
 * signal name at all (ordinary prose) is never flagged — only
 * fabricated *evidence*, not fabricated *wording*, is this validator's
 * concern.
 */
const ALL_KNOWN_SIGNAL_NAMES: readonly string[] = [
  ...CLAIM_SIGNAL_NAMES,
  ...METADATA_SIGNAL_NAMES,
  ...VISUAL_SIGNAL_NAMES,
  ...AUDIO_SIGNAL_NAMES,
  ...DEVICE_SIGNAL_NAMES,
  ...LINGUISTIC_SIGNAL_NAMES,
  ...ELICITATION_SIGNAL_NAMES,
];

export interface NarrativeValidationResult {
  readonly valid: boolean;
  readonly unsupportedSignalNames: readonly string[];
}

function allowedSignalNames(report: EvidenceReport): ReadonlySet<string> {
  return new Set([
    ...report.topContributingSignals.map((s) => s.signalName),
    ...report.contradictoryEvidence.map((s) => s.signalName),
    ...report.missingEvidence.map((m) => m.signalName),
  ]);
}

export function validateNarrative(
  narrative: string,
  report: EvidenceReport,
): NarrativeValidationResult {
  const allowed = allowedSignalNames(report);
  const unsupportedSignalNames = ALL_KNOWN_SIGNAL_NAMES.filter(
    (signalName) => narrative.includes(signalName) && !allowed.has(signalName),
  );

  return { valid: unsupportedSignalNames.length === 0, unsupportedSignalNames };
}
