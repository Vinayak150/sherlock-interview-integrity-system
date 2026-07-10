import { useEffect, useState } from 'react';

import type { DashboardApiClient } from '../apiClient.js';
import { parseStreamDecision, type StreamDecision } from '../lib/decisionData.js';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export function useDecisionStream(
  apiClient: DashboardApiClient,
  sessionId: string,
): {
  readonly latestDecision: StreamDecision | null;
  readonly decisionHistory: readonly StreamDecision[];
  readonly connectionState: ConnectionState;
} {
  const [latestDecision, setLatestDecision] = useState<StreamDecision | null>(null);
  const [decisionHistory, setDecisionHistory] = useState<readonly StreamDecision[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    if (sessionId.trim() === '') {
      setLatestDecision(null);
      setDecisionHistory([]);
      setConnectionState('disconnected');
      return;
    }

    setConnectionState('connecting');
    const source = new EventSource(apiClient.sessionEventsUrl(sessionId));

    source.onopen = () => setConnectionState('connected');
    source.onerror = () => setConnectionState('disconnected');
    source.onmessage = (event) => {
      try {
        const parsed = parseStreamDecision(JSON.parse(event.data as string));
        if (parsed === null) return;
        setLatestDecision(parsed);
        setDecisionHistory((previous) => [...previous, parsed]);
        setConnectionState('connected');
      } catch {
        // Ignore malformed SSE payloads.
      }
    };

    return () => {
      source.close();
      setConnectionState('disconnected');
    };
  }, [apiClient, sessionId]);

  return { latestDecision, decisionHistory, connectionState };
}
