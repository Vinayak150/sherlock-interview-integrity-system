import { AlertTriangle, Brain, FileText, GitBranch, Layers, Sparkles } from 'lucide-react';

import type { TimelineEvent, TimelineEventType } from '../lib/decisionData.js';
import { formatTimestamp } from '../lib/utils.js';
import { EmptyState } from './EmptyState.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.js';
import { Skeleton } from './ui/skeleton.js';

const ICON_BY_TYPE: Record<TimelineEventType, typeof FileText> = {
  evidence_added: Layers,
  fusion_updated: Brain,
  lifecycle_changed: GitBranch,
  decision_generated: AlertTriangle,
  explanation_created: Sparkles,
};

export function Timeline({
  events,
  loading,
}: {
  readonly events: readonly TimelineEvent[];
  readonly loading: boolean;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
        <CardDescription>Recent pipeline activity for this session</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : events.length === 0 ? (
          <EmptyState variant="waiting-activity" className="border-none shadow-none" />
        ) : (
          <ol className="relative space-y-0 border-l border-zinc-200 pl-6">
            {events.map((event) => {
              const Icon = ICON_BY_TYPE[event.type] ?? FileText;
              return (
                <li key={event.id} className="relative pb-6 last:pb-0">
                  <span className="absolute -left-[1.9rem] flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white shadow-sm">
                    <Icon className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                  </span>
                  <div className="rounded-lg border border-zinc-100 bg-zinc-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-zinc-900">{event.title}</p>
                      <time className="text-xs text-zinc-500" dateTime={event.timestamp}>
                        {formatTimestamp(event.timestamp)}
                      </time>
                    </div>
                    <p className="mt-1 text-sm text-zinc-600">{event.description}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
