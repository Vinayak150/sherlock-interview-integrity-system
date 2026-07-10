/**
 * The Interviewer live badge (RFC §14): "a minimal, 3-tier collapse of
 * the 8 states ... shown during the live call, deliberately not exposing
 * the full 8-state detail or raw probability to the interviewer in the
 * moment." Pure mapping, no I/O — the full 8-state detail and raw
 * probability are still available in the Reviewer Dashboard proper
 * (`Dashboard.tsx`), which is a different, deliberately more detailed
 * surface for a different audience (a reviewer, not the live
 * interviewer).
 */
export type LifecycleState =
  | 'UNKNOWN'
  | 'POSSIBLE_CANDIDATE'
  | 'LIKELY_CANDIDATE'
  | 'HIGHLY_CONFIDENT'
  | 'CONFIRMED'
  | 'RECOVERED'
  | 'LOST_CONFIDENCE'
  | 'DISQUALIFIED';

export type LiveBadgeTier = 'BUILDING_CONFIDENCE' | 'CONFIRMED' | 'NEEDS_ATTENTION';

export interface LiveBadge {
  readonly tier: LiveBadgeTier;
  readonly label: string;
}

const TIER_BY_STATE: Readonly<Record<LifecycleState, LiveBadgeTier>> = {
  UNKNOWN: 'BUILDING_CONFIDENCE',
  POSSIBLE_CANDIDATE: 'BUILDING_CONFIDENCE',
  LIKELY_CANDIDATE: 'BUILDING_CONFIDENCE',
  HIGHLY_CONFIDENT: 'CONFIRMED',
  CONFIRMED: 'CONFIRMED',
  RECOVERED: 'CONFIRMED',
  LOST_CONFIDENCE: 'NEEDS_ATTENTION',
  DISQUALIFIED: 'NEEDS_ATTENTION',
};

const LABEL_BY_TIER: Readonly<Record<LiveBadgeTier, string>> = {
  BUILDING_CONFIDENCE: 'Building confidence',
  CONFIRMED: 'Confirmed',
  NEEDS_ATTENTION: 'Needs attention',
};

export function collapseToLiveBadge(state: LifecycleState): LiveBadge {
  const tier = TIER_BY_STATE[state];
  return { tier, label: LABEL_BY_TIER[tier] };
}
