import type { StreamDecision } from '../../lib/decisionData.js';
import {
  buildAiEvidenceSummary,
  buildContradictionItems,
  buildCrossModalConsistencyView,
  buildSessionDiagnostics,
  MODEL_STACK_INFO,
  type ConfidenceBand,
  type ModalityStance,
} from '../../lib/reasoningPresentation.js';
import { formatPercent, formatTimestamp } from '../../lib/utils.js';
import { EmptyState } from '../EmptyState.js';
import { Badge } from '../ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card.js';
import { Skeleton } from '../ui/skeleton.js';

function confidenceBadgeVariant(band: ConfidenceBand): 'success' | 'warning' | 'danger' {
  switch (band) {
    case 'high':
      return 'success';
    case 'medium':
      return 'warning';
    default:
      return 'danger';
  }
}

function stanceBadgeVariant(stance: ModalityStance): 'success' | 'danger' | 'muted' {
  switch (stance) {
    case 'ALIGNED':
      return 'success';
    case 'CONTRADICTING':
      return 'danger';
    default:
      return 'muted';
  }
}

function stanceLabel(stance: ModalityStance): string {
  switch (stance) {
    case 'ALIGNED':
      return 'Aligned';
    case 'CONTRADICTING':
      return 'Contradicting';
    default:
      return 'Unknown';
  }
}

function severityVariant(severity: string): 'critical' | 'danger' | 'warning' {
  switch (severity) {
    case 'HIGH':
      return 'critical';
    case 'MEDIUM':
      return 'danger';
    default:
      return 'warning';
  }
}

export function AiEvidenceSummaryCard({
  decision,
  loading,
}: {
  readonly decision: StreamDecision | null;
  readonly loading: boolean;
}): React.JSX.Element {
  const summary = buildAiEvidenceSummary(decision);

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Evidence Summary</CardTitle>
        <CardDescription>
          Confidence, uncertainty, and reviewer recommendation from the live decision stream
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-28 w-full" />
        ) : summary === null ? (
          <EmptyState variant="waiting-activity" className="border-none shadow-none" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricTile
              label="Confidence"
              value={formatPercent(summary.confidence)}
              badge={
                <Badge variant={confidenceBadgeVariant(summary.band)}>
                  {summary.band.toUpperCase()}
                </Badge>
              }
            />
            {summary.rawConfidence !== null && (
              <MetricTile label="Raw confidence" value={formatPercent(summary.rawConfidence)} />
            )}
            {summary.calibratedConfidence !== null && (
              <MetricTile
                label="Calibrated confidence"
                value={formatPercent(summary.calibratedConfidence)}
              />
            )}
            <MetricTile label="Uncertainty" value={formatPercent(summary.uncertainty)} />
            <MetricTile
              label="Recommendation"
              value={summary.recommendation}
              className="sm:col-span-2 lg:col-span-1"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricTile({
  label,
  value,
  badge,
  className = '',
}: {
  readonly label: string;
  readonly value: string;
  readonly badge?: React.ReactNode;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <div
      className={`rounded-lg border border-border bg-muted/40 p-4 dark:bg-muted/20 ${className}`}
    >
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-lg font-semibold text-foreground">{value}</p>
        {badge}
      </div>
    </div>
  );
}

export function CrossModalConsistencyCard({
  decision,
  loading,
}: {
  readonly decision: StreamDecision | null;
  readonly loading: boolean;
}): React.JSX.Element {
  const view = buildCrossModalConsistencyView(decision);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Cross-Modal Consistency</CardTitle>
        <CardDescription>Face, voice, metadata, and transcript alignment</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : view === null ? (
          <EmptyState variant="waiting-activity" className="border-none shadow-none" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[20rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Modality</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium">Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {view.modalities.map((row) => (
                    <tr key={row.modality} className="border-b border-border/60 last:border-0">
                      <td className="py-3 pr-3 font-medium text-foreground">{row.modality}</td>
                      <td className="py-3 pr-3">
                        <Badge
                          variant={stanceBadgeVariant(row.stance)}
                          aria-label={`${row.modality} status ${stanceLabel(row.stance)}`}
                        >
                          {stanceLabel(row.stance)}
                        </Badge>
                      </td>
                      <td className="py-3 text-muted-foreground">
                        {row.signalName === null ? '—' : `${row.bundle}/${row.signalName}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ScoreTile
                label="Overall consistency"
                value={
                  view.overallConsistency === null ? '—' : formatPercent(view.overallConsistency)
                }
              />
              <ScoreTile
                label="Overall disagreement"
                value={
                  view.overallDisagreement === null ? '—' : formatPercent(view.overallDisagreement)
                }
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ScoreTile({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 dark:bg-muted/20">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function ContradictionPanel({
  decision,
  loading,
}: {
  readonly decision: StreamDecision | null;
  readonly loading: boolean;
}): React.JSX.Element {
  const items = buildContradictionItems(decision);
  const grouped = {
    HIGH: items.filter((item) => item.severity === 'HIGH'),
    MEDIUM: items.filter((item) => item.severity === 'MEDIUM'),
    LOW: items.filter((item) => item.severity === 'LOW'),
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Contradictions</CardTitle>
        <CardDescription>Detected conflicting evidence grouped by severity</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No contradicting evidence detected.</p>
        ) : (
          <div className="space-y-5">
            {(['HIGH', 'MEDIUM', 'LOW'] as const).map((severity) => {
              const group = grouped[severity];
              if (group.length === 0) return null;
              return (
                <section key={severity}>
                  <div className="mb-2 flex items-center gap-2">
                    <Badge variant={severityVariant(severity)}>{severity}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {String(group.length)} item{group.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {group.map((item) => (
                      <li
                        key={item.id}
                        className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm dark:bg-muted/20"
                      >
                        <p className="font-medium text-foreground">
                          {item.bundle}/{item.signalName}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatTimestamp(item.timestamp)} · {item.participant}
                          {item.confidenceImpact !== null
                            ? ` · ${item.confidenceImpact >= 0 ? '+' : ''}${item.confidenceImpact.toFixed(3)} log-LR`
                            : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ModelInformationCard(): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Information</CardTitle>
        <CardDescription>Read-only stack overview for this deployment</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 sm:grid-cols-2">
          {MODEL_STACK_INFO.map((row) => (
            <div
              key={row.label}
              className="rounded-lg border border-border bg-muted/30 p-3 dark:bg-muted/20"
            >
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {row.label}
              </dt>
              <dd className="mt-1 text-sm text-foreground">{row.detail}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export function SessionDiagnosticsCard({
  decision,
  loading,
}: {
  readonly decision: StreamDecision | null;
  readonly loading: boolean;
}): React.JSX.Element | null {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Session Diagnostics</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const diagnostics = buildSessionDiagnostics(decision);
  if (diagnostics === null) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session Diagnostics</CardTitle>
        <CardDescription>
          Inference latency, model versions, and observability fields from evidence values
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        {diagnostics.inferenceLatencyMs.length > 0 && (
          <DiagnosticsList
            title="Inference latency (ms)"
            items={diagnostics.inferenceLatencyMs.map((row) => ({
              label: row.label,
              value: row.value.toFixed(1),
            }))}
          />
        )}
        {diagnostics.modelVersions.length > 0 && (
          <DiagnosticsList title="Model versions" items={diagnostics.modelVersions} />
        )}
        {diagnostics.observabilityMetrics.length > 0 && (
          <DiagnosticsList title="Observability metrics" items={diagnostics.observabilityMetrics} />
        )}
      </CardContent>
    </Card>
  );
}

function DiagnosticsList({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly { label: string; value: string }[];
}): React.JSX.Element {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="space-y-2 text-sm">
        {items.map((item) => (
          <li key={`${item.label}-${item.value}`} className="flex justify-between gap-3">
            <span className="text-muted-foreground">{item.label}</span>
            <span className="font-medium text-foreground">{item.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
