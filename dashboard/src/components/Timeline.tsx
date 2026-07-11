import { AlertTriangle, Brain, FileText, GitBranch, Layers, Sparkles } from 'lucide-react';

import type { TimelineEvent, TimelineEventType } from '../lib/decisionData.js';
import { formatTimestamp } from '../lib/utils.js';
import { EmptyState } from './EmptyState.js';
import { Badge } from './ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.js';
import { Skeleton } from './ui/skeleton.js';

const ICON_BY_TYPE: Record<TimelineEventType, typeof FileText> = {
  evidence_added: Layers,
  fusion_updated: Brain,
  lifecycle_changed: GitBranch,
  decision_generated: AlertTriangle,
  explanation_created: Sparkles,
};

function classificationVariant(
  classification: TimelineEvent['classification'],
): 'success' | 'danger' | 'warning' | 'muted' {
  switch (classification) {
    case 'SUPPORTS':
      return 'success';
    case 'CONTRADICTS':
      return 'danger';
    case 'MISSING':
      return 'warning';
    default:
      return 'muted';
  }
}

function classificationLabel(classification: TimelineEvent['classification']): string | null {
  if (classification === undefined) return null;
  return classification.toLowerCase();
}

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
        <CardTitle>Evidence Timeline</CardTitle>
        <CardDescription>Evidence, classification, confidence impact, and posterior updates</CardDescription>
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
          <ol className="relative space-y-0 border-l border-border pl-6">
            {events.map((event) => {
              const Icon = ICON_BY_TYPE[event.type] ?? FileText;
              const classLabel = classificationLabel(event.classification);
              return (
                <li key={event.id} className="relative pb-6 last:pb-0">
                  <span className="absolute -left-[1.9rem] flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card shadow-sm">
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </span>
                  <div className="rounded-lg border border-border bg-muted/30 p-4 dark:bg-muted/20">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-foreground">{event.title}</p>
                      <time className="text-xs text-muted-foreground" dateTime={event.timestamp}>
                        {formatTimestamp(event.timestamp)}
                      </time>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{event.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {classLabel !== null && event.classification !== undefined && (
                        <Badge
                          variant={classificationVariant(event.classification)}
                          aria-label={`Classification ${classLabel}`}
                        >
                          {classLabel}
                        </Badge>
                      )}
                      {event.confidenceImpact !== undefined && event.confidenceImpact !== null && (
                        <span className="text-xs text-muted-foreground">
                          Impact: {event.confidenceImpact >= 0 ? '+' : ''}
                          {event.confidenceImpact.toFixed(3)} log-LR
                        </span>
                      )}
                      {event.currentConfidence !== undefined && event.currentConfidence !== null && (
                        <span className="text-xs text-muted-foreground">
                          Confidence: {(event.currentConfidence * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
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
