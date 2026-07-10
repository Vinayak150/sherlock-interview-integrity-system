import { useState } from 'react';

import { AggregateView, Dashboard } from './Dashboard.js';
import { DashboardApiClient } from './apiClient.js';

const ORCHESTRATOR_BASE_URL =
  (import.meta.env.VITE_ORCHESTRATOR_URL as string | undefined) ?? 'http://localhost:8080';

export function App(): React.JSX.Element {
  const [apiClient] = useState(() => new DashboardApiClient(ORCHESTRATOR_BASE_URL));
  const [sessionId, setSessionId] = useState('');

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <header style={{ padding: 16, borderBottom: '1px solid #e5e7eb' }}>
        <h1>Sherlock Reviewer Dashboard</h1>
        <input
          type="text"
          placeholder="session id"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
        />
      </header>
      {sessionId.trim() !== '' && <Dashboard apiClient={apiClient} sessionId={sessionId.trim()} />}
      <AggregateView apiClient={apiClient} />
    </div>
  );
}
