import type { LifecycleState } from './liveBadgeLogic.js';
import { collapseToLiveBadge } from './liveBadgeLogic.js';

const COLOR_BY_TIER: Record<string, string> = {
  BUILDING_CONFIDENCE: '#6b7280',
  CONFIRMED: '#16a34a',
  NEEDS_ATTENTION: '#dc2626',
};

/** The Interviewer-facing live badge (RFC §14) -- deliberately the only thing rendered here, never the raw probability or the full 8-state detail. */
export function LiveBadge({
  lifecycleState,
}: {
  readonly lifecycleState: LifecycleState;
}): React.JSX.Element {
  const badge = collapseToLiveBadge(lifecycleState);
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 12px',
        borderRadius: 999,
        color: 'white',
        fontWeight: 600,
        backgroundColor: COLOR_BY_TIER[badge.tier],
      }}
    >
      {badge.label}
    </span>
  );
}
