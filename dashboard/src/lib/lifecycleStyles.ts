import type { LifecycleState } from '../liveBadgeLogic.js';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical' | 'neutral';

const RISK_BY_STATE: Record<LifecycleState, RiskLevel> = {
  UNKNOWN: 'neutral',
  POSSIBLE_CANDIDATE: 'medium',
  LIKELY_CANDIDATE: 'medium',
  HIGHLY_CONFIDENT: 'low',
  CONFIRMED: 'low',
  RECOVERED: 'low',
  LOST_CONFIDENCE: 'high',
  DISQUALIFIED: 'critical',
};

export function riskLevelForState(state: LifecycleState): RiskLevel {
  return RISK_BY_STATE[state];
}

export function lifecycleBadgeClass(state: LifecycleState): string {
  const risk = riskLevelForState(state);
  switch (risk) {
    case 'low':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'medium':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'high':
      return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'critical':
      return 'bg-red-50 text-red-700 border-red-200';
    default:
      return 'bg-zinc-100 text-zinc-600 border-zinc-200';
  }
}

export function formatLifecycleState(state: LifecycleState): string {
  return state.replaceAll('_', ' ');
}
