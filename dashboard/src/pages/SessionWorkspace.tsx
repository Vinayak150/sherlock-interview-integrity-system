import { useCallback, useState } from 'react';

import type { DashboardApiClient } from '../apiClient.js';
import {
  AiEvidenceSummaryCard,
  ContradictionPanel,
  CrossModalConsistencyCard,
  ModelInformationCard,
  SessionDiagnosticsCard,
} from '../components/cards/AiReasoningCards.js';
import { AccommodationForm, ExplanationPanel } from '../components/cards/ExplanationPanel.js';
import { DecisionPanel } from '../components/cards/DecisionPanel.js';
import { EvidenceSummary, SessionPanel } from '../components/cards/SessionPanel.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorAlert } from '../components/ui/alert.js';
import { Timeline } from '../components/Timeline.js';
import { useDecisionStream } from '../hooks/useDecisionStream.js';
import { useSessionStatus } from '../hooks/useSessionStatus.js';
import { buildTimeline, summarizeEvidenceBundles } from '../lib/decisionData.js';
import type { LifecycleState } from '../liveBadgeLogic.js';

export function SessionWorkspace({
  apiClient,
  sessionId,
}: {
  readonly apiClient: DashboardApiClient;
  readonly sessionId: string;
}): React.JSX.Element {
  const [overrideReason, setOverrideReason] = useState('');
  const [disclosureReason, setDisclosureReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const { latestDecision, decisionHistory } = useDecisionStream(apiClient, sessionId);
  const { status, loading, error, refresh } = useSessionStatus(
    apiClient,
    sessionId,
    refreshKey + decisionHistory.length,
  );

  const applyOverride = useCallback(
    (nextState: LifecycleState) => {
      setSubmitting(true);
      setActionError(null);
      apiClient
        .applyOverride(
          sessionId,
          nextState,
          overrideReason.trim() === '' ? undefined : overrideReason,
        )
        .then(() => {
          setRefreshKey((value) => value + 1);
          refresh();
        })
        .catch((err: unknown) => {
          setActionError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => setSubmitting(false));
    },
    [apiClient, sessionId, overrideReason, refresh],
  );

  const handleDisclosure = useCallback(() => {
    if (disclosureReason.trim() === '') return;
    setSubmitting(true);
    setActionError(null);
    apiClient
      .recordAccommodationDisclosure(sessionId, disclosureReason)
      .then(() => {
        setDisclosureReason('');
        setRefreshKey((value) => value + 1);
        refresh();
      })
      .catch((err: unknown) => {
        setActionError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setSubmitting(false));
  }, [apiClient, disclosureReason, refresh, sessionId]);

  return (
    <div className="space-y-6">
      {(error !== null || actionError !== null) && (
        <ErrorAlert
          message={actionError ?? error ?? 'Unknown error'}
          onRetry={() => {
            setActionError(null);
            refresh();
          }}
        />
      )}

      <SessionPanel
        sessionId={sessionId}
        status={status}
        decision={latestDecision}
        loading={loading}
      />

      <EvidenceSummary
        summaries={summarizeEvidenceBundles(latestDecision)}
        loading={loading && latestDecision === null}
      />

      <AiEvidenceSummaryCard
        decision={latestDecision}
        loading={loading && latestDecision === null}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <CrossModalConsistencyCard
          decision={latestDecision}
          loading={loading && latestDecision === null}
        />
        <ContradictionPanel
          decision={latestDecision}
          loading={loading && latestDecision === null}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Timeline
          events={buildTimeline(decisionHistory)}
          loading={loading && decisionHistory.length === 0}
        />
        <DecisionPanel
          decision={latestDecision}
          loading={loading && latestDecision === null}
          overrideReason={overrideReason}
          onOverrideReasonChange={setOverrideReason}
          onApprove={() => applyOverride('CONFIRMED')}
          onEscalate={() => applyOverride('LOST_CONFIDENCE')}
          onReject={() => applyOverride('DISQUALIFIED')}
          onOverrideState={applyOverride}
          submitting={submitting}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ExplanationPanel decision={latestDecision} loading={loading && latestDecision === null} />
        <AccommodationForm
          reason={disclosureReason}
          onReasonChange={setDisclosureReason}
          onSubmit={handleDisclosure}
          disabled={submitting}
        />
      </div>

      <SessionDiagnosticsCard
        decision={latestDecision}
        loading={loading && latestDecision === null}
      />

      <ModelInformationCard />
    </div>
  );
}

export function SessionSearchEmpty(): React.JSX.Element {
  return (
    <EmptyState
      title="Search for a session to begin"
      description="Enter a session ID above to load live status, evidence summaries, decisions, and reviewer actions."
    />
  );
}
