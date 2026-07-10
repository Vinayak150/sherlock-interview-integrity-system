import { useMemo, useState } from 'react';

import { DashboardApiClient } from '../apiClient.js';
import { AggregateDashboard } from '../components/charts/AggregateDashboard.js';
import {
  DashboardSidebar,
  DashboardTopBar,
  SearchBar,
  type DashboardSection,
} from '../components/layout/DashboardShell.js';
import { StatisticsRow } from '../components/StatisticsRow.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ui/alert.js';
import { useAggregateStatus } from '../hooks/useAggregateStatus.js';
import { useDecisionStream } from '../hooks/useDecisionStream.js';
import { useSessionStatus } from '../hooks/useSessionStatus.js';
import { useTheme } from '../hooks/useTheme.js';
import { SessionWorkspace } from './SessionWorkspace.js';

const ORCHESTRATOR_BASE_URL =
  (import.meta.env.VITE_ORCHESTRATOR_URL as string | undefined) ?? 'http://localhost:8080';

export function ReviewerDashboard({
  onGoHome,
}: {
  readonly onGoHome: () => void;
}): React.JSX.Element {
  const [apiClient] = useState(() => new DashboardApiClient(ORCHESTRATOR_BASE_URL));
  const [searchInput, setSearchInput] = useState('');
  const [activeSessionId, setActiveSessionId] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState<DashboardSection>('overview');

  const {
    aggregate,
    loading: aggregateLoading,
    error: aggregateError,
    refresh,
  } = useAggregateStatus(apiClient);
  const { connectionState } = useDecisionStream(apiClient, activeSessionId);
  const { status: activeStatus } = useSessionStatus(apiClient, activeSessionId, 0);
  const { resolved, toggle } = useTheme();

  const environment = useMemo(() => {
    const configured = import.meta.env.VITE_ENVIRONMENT as string | undefined;
    if (configured !== undefined && configured.trim() !== '') return configured;
    return import.meta.env.MODE;
  }, []);

  const handleSearch = () => {
    setActiveSessionId(searchInput.trim());
    if (searchInput.trim() !== '') setActiveSection('workspace');
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <DashboardSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        onGoHome={onGoHome}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopBar
          connectionState={connectionState}
          environment={environment}
          lifecycleState={activeStatus?.lifecycleState}
          onToggleTheme={toggle}
          resolvedTheme={resolved}
        />

        <main className="flex-1 space-y-8 px-4 py-8 lg:px-8">
          {aggregateError !== null && <ErrorAlert message={aggregateError} onRetry={refresh} />}

          {(activeSection === 'overview' || activeSection === 'workspace') && (
            <>
              <StatisticsRow aggregate={aggregate} loading={aggregateLoading} />
              <SearchBar value={searchInput} onChange={setSearchInput} onSubmit={handleSearch} />
            </>
          )}

          {activeSection === 'overview' && (
            <div className="grid gap-6 lg:grid-cols-2">
              <EmptyState
                variant="no-session"
                title="Reviewer workspace"
                description="Select a session from the search bar or open the workspace section to begin review."
              />
              <section className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold">Aggregate preview</h2>
                  <p className="text-sm text-muted-foreground">
                    Replica-scoped metrics at a glance
                  </p>
                </div>
                <AggregateDashboard aggregate={aggregate} loading={aggregateLoading} />
              </section>
            </div>
          )}

          {activeSection === 'workspace' &&
            (activeSessionId.trim() === '' ? (
              <EmptyState variant="no-session" />
            ) : (
              <SessionWorkspace apiClient={apiClient} sessionId={activeSessionId} />
            ))}

          {activeSection === 'aggregate' && (
            <section aria-label="Aggregate dashboard section" className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">Aggregate Analytics</h2>
                <p className="text-sm text-muted-foreground">
                  Replica-scoped metrics refreshed every five seconds
                </p>
              </div>
              <AggregateDashboard aggregate={aggregate} loading={aggregateLoading} />
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
