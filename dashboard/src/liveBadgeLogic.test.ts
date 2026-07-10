import { describe, expect, it } from 'vitest';

import { collapseToLiveBadge } from './liveBadgeLogic.js';
import type { LifecycleState } from './liveBadgeLogic.js';

const ALL_STATES: readonly LifecycleState[] = [
  'UNKNOWN',
  'POSSIBLE_CANDIDATE',
  'LIKELY_CANDIDATE',
  'HIGHLY_CONFIDENT',
  'CONFIRMED',
  'RECOVERED',
  'LOST_CONFIDENCE',
  'DISQUALIFIED',
];

describe('collapseToLiveBadge', () => {
  it('collapses every climbing tier to "Building confidence"', () => {
    for (const state of ['UNKNOWN', 'POSSIBLE_CANDIDATE', 'LIKELY_CANDIDATE'] as const) {
      expect(collapseToLiveBadge(state)).toEqual({
        tier: 'BUILDING_CONFIDENCE',
        label: 'Building confidence',
      });
    }
  });

  it('collapses HIGHLY_CONFIDENT, CONFIRMED, and RECOVERED to "Confirmed"', () => {
    for (const state of ['HIGHLY_CONFIDENT', 'CONFIRMED', 'RECOVERED'] as const) {
      expect(collapseToLiveBadge(state)).toEqual({ tier: 'CONFIRMED', label: 'Confirmed' });
    }
  });

  it('collapses LOST_CONFIDENCE and DISQUALIFIED to "Needs attention"', () => {
    for (const state of ['LOST_CONFIDENCE', 'DISQUALIFIED'] as const) {
      expect(collapseToLiveBadge(state)).toEqual({
        tier: 'NEEDS_ATTENTION',
        label: 'Needs attention',
      });
    }
  });

  it('produces exactly one of the three tiers for every defined lifecycle state', () => {
    for (const state of ALL_STATES) {
      expect(['BUILDING_CONFIDENCE', 'CONFIRMED', 'NEEDS_ATTENTION']).toContain(
        collapseToLiveBadge(state).tier,
      );
    }
  });

  it('is a pure function -- the same input always yields the same output', () => {
    expect(collapseToLiveBadge('CONFIRMED')).toEqual(collapseToLiveBadge('CONFIRMED'));
  });
});
