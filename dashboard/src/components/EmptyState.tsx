import { Activity, FileSearch, Inbox, Radio, SearchX, type LucideIcon } from 'lucide-react';

import { Card, CardContent } from './ui/card.js';
import { cn } from '../lib/utils.js';

export type EmptyStateVariant = 'no-session' | 'no-evidence' | 'waiting-activity' | 'generic';

const VARIANTS: Record<
  EmptyStateVariant,
  { readonly icon: LucideIcon; readonly title: string; readonly description: string }
> = {
  'no-session': {
    icon: SearchX,
    title: 'No session selected',
    description: 'Search for a session ID to load live status, evidence, and reviewer actions.',
  },
  'no-evidence': {
    icon: FileSearch,
    title: 'No evidence yet',
    description: 'Evidence cards will populate once the session receives bundle events.',
  },
  'waiting-activity': {
    icon: Radio,
    title: 'Waiting for interview activity',
    description: 'Connect to the live decision stream and wait for the next pipeline update.',
  },
  generic: {
    icon: Inbox,
    title: 'Nothing to display',
    description: 'Content will appear when data becomes available from the orchestrator.',
  },
};

export function EmptyState({
  variant = 'generic',
  title,
  description,
  className,
}: {
  readonly variant?: EmptyStateVariant;
  readonly title?: string;
  readonly description?: string;
  readonly className?: string;
}): React.JSX.Element {
  const preset = VARIANTS[variant];
  const Icon = preset.icon;

  return (
    <Card className={cn('border-dashed', className)}>
      <CardContent className="flex flex-col items-center justify-center gap-5 px-6 py-16 text-center">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-muted blur-xl" aria-hidden="true" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
            <Icon className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          </div>
        </div>
        <div className="max-w-md space-y-2">
          <h2 className="text-lg font-semibold">{title ?? preset.title}</h2>
          <p className="text-sm text-muted-foreground">{description ?? preset.description}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-hidden="true">
          <Activity className="h-3 w-3" />
          <span>Awaiting orchestrator data</span>
        </div>
      </CardContent>
    </Card>
  );
}
