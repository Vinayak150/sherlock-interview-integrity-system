import type { DashboardApiClient } from './apiClient.js';
import { AggregateDashboard } from './components/charts/AggregateDashboard.js';
import { useAggregateStatus } from './hooks/useAggregateStatus.js';
import { SessionWorkspace } from './pages/SessionWorkspace.js';

/**
 * Backward-compatible exports for the reviewer dashboard shell.
 * The redesigned UI lives in `App.tsx`, `SessionWorkspace`, and shared components.
 */
export function Dashboard({
  apiClient,
  sessionId,
}: {
  readonly apiClient: DashboardApiClient;
  readonly sessionId: string;
}): React.JSX.Element {
  return <SessionWorkspace apiClient={apiClient} sessionId={sessionId} />;
}

export function AggregateView({
  apiClient,
}: {
  readonly apiClient: DashboardApiClient;
}): React.JSX.Element {
  const { aggregate, loading } = useAggregateStatus(apiClient);
  return <AggregateDashboard aggregate={aggregate} loading={loading} />;
}
