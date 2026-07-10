import { useEffect, useState } from 'react';

import type { DashboardApiClient } from './apiClient.js';

/**
 * Subscribes to one session's live `Decision` stream (Plan M13: "SSE...
 * client") via the browser's native `EventSource`, backed by the
 * orchestrator's `GET /sessions/:id/events` endpoint
 * (`orchestrator/src/api/httpServer.ts`'s `handleSubscribeToSession`).
 */
export function useSessionEvents(apiClient: DashboardApiClient, sessionId: string): unknown {
  const [latestDecision, setLatestDecision] = useState<unknown>(null);

  useEffect(() => {
    const source = new EventSource(apiClient.sessionEventsUrl(sessionId));
    source.onmessage = (event) => {
      setLatestDecision(JSON.parse(event.data));
    };
    return () => source.close();
  }, [apiClient, sessionId]);

  return latestDecision;
}
