import { cva } from 'class-variance-authority';

import type { LifecycleState } from './liveBadgeLogic.js';
import { collapseToLiveBadge } from './liveBadgeLogic.js';
import { cn } from './lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide',
  {
    variants: {
      tier: {
        BUILDING_CONFIDENCE: 'bg-zinc-700 text-white',
        CONFIRMED: 'bg-emerald-600 text-white',
        NEEDS_ATTENTION: 'bg-red-600 text-white',
      },
    },
    defaultVariants: {
      tier: 'BUILDING_CONFIDENCE',
    },
  },
);

/** Interviewer-facing live badge — 3-tier collapse of the 8 lifecycle states (RFC §14). */
export function LiveBadge({
  lifecycleState,
  className,
}: {
  readonly lifecycleState: LifecycleState;
  readonly className?: string;
}): React.JSX.Element {
  const badge = collapseToLiveBadge(lifecycleState);
  return (
    <span className={cn(badgeVariants({ tier: badge.tier }), className)} aria-label={badge.label}>
      {badge.label}
    </span>
  );
}
