import { useCallback, useEffect, useState } from 'react';

import type { AggregateStatus, DashboardApiClient, SessionStatus } from './apiClient.js';
import { LiveBadge } from './LiveBadge.js';
import type { LifecycleState } from './liveBadgeLogic.js';
import { useSessionEvents } from './useSessionEvents.js';

const ALL_LIFECYCLE_STATES: readonly LifecycleState[] = [
  'UNKNOWN',
  'POSSIBLE_CANDIDATE',
  'LIKELY_CANDIDATE',
  'HIGHLY_CONFIDENT',
  'CONFIRMED',
  'RECOVERED',
  'LOST_CONFIDENCE',
  'DISQUALIFIED',
];

/**
 * The full Reviewer Dashboard (Plan M13): the 8-state detail view (unlike
 * the Interviewer's collapsed `LiveBadge`), an override action
 * (`HumanOverrideAction` round-trip, ADR-3), and an accommodation-
 * disclosure form (RFC §11/ADR-13).
 */
export function Dashboard({
  apiClient,
  sessionId,
}: {
  readonly apiClient: DashboardApiClient;
  readonly sessionId: string;
}): React.JSX.Element {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [disclosureReason, setDisclosureReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const liveDecision = useSessionEvents(apiClient, sessionId);

  const refreshStatus = useCallback(() => {
    apiClient
      .getSessionStatus(sessionId)
      .then(setStatus)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [apiClient, sessionId]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus, liveDecision]);

  const handleOverride = useCallback(
    (nextState: LifecycleState) => {
      apiClient
        .applyOverride(
          sessionId,
          nextState,
          overrideReason.trim() === '' ? undefined : overrideReason,
        )
        .then(refreshStatus)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    },
    [apiClient, sessionId, overrideReason, refreshStatus],
  );

  const handleDisclosure = useCallback(() => {
    if (disclosureReason.trim() === '') return;
    apiClient
      .recordAccommodationDisclosure(sessionId, disclosureReason)
      .then(refreshStatus)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [apiClient, sessionId, disclosureReason, refreshStatus]);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16, maxWidth: 640 }}>
      <h2>Session {sessionId}</h2>
      {error !== null && <p style={{ color: '#dc2626' }}>Error: {error}</p>}
      {status !== null && (
        <>
          <p>
            Live badge: <LiveBadge lifecycleState={status.lifecycleState} />
          </p>
          <p>Full lifecycle state: {status.lifecycleState}</p>
          <p>
            Accommodation disclosure on file: {status.hasAccommodationDisclosure ? 'yes' : 'no'}
          </p>
        </>
      )}

      <section>
        <h3>Human override (ADR-3)</h3>
        <input
          type="text"
          placeholder="reason (optional)"
          value={overrideReason}
          onChange={(e) => setOverrideReason(e.target.value)}
        />
        <div>
          {ALL_LIFECYCLE_STATES.map((state) => (
            <button key={state} onClick={() => handleOverride(state)} style={{ margin: 4 }}>
              {state}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Accommodation disclosure (RFC §11, ADR-13)</h3>
        <input
          type="text"
          placeholder="reason (e.g. interpreter present)"
          value={disclosureReason}
          onChange={(e) => setDisclosureReason(e.target.value)}
        />
        <button onClick={handleDisclosure}>Record disclosure</button>
      </section>
    </div>
  );
}

/** The `UNKNOWN`-rate aggregate view (Plan M13; RFC §10 Committee Note). */
export function AggregateView({
  apiClient,
}: {
  readonly apiClient: DashboardApiClient;
}): React.JSX.Element {
  const [aggregate, setAggregate] = useState<AggregateStatus | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      apiClient
        .getAggregateStatus()
        .then(setAggregate)
        .catch(() => undefined);
    }, 5000);
    apiClient
      .getAggregateStatus()
      .then(setAggregate)
      .catch(() => undefined);
    return () => clearInterval(interval);
  }, [apiClient]);

  if (aggregate === null) return <p>Loading aggregate status...</p>;

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <h3>Aggregate status ({aggregate.totalSessions} sessions on this replica)</h3>
      <p>UNKNOWN rate: {(aggregate.unknownRate * 100).toFixed(1)}%</p>
      <ul>
        {Object.entries(aggregate.countsByState).map(([state, count]) => (
          <li key={state}>
            {state}: {count}
          </li>
        ))}
      </ul>
    </div>
  );
}
