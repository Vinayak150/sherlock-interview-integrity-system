import { useCallback, useEffect, useState } from 'react';

import type { DashboardApiClient, SessionStatus } from '../apiClient.js';

export function useSessionStatus(
  apiClient: DashboardApiClient,
  sessionId: string,
  refreshKey: number,
): {
  readonly status: SessionStatus | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (sessionId.trim() === '') {
      setStatus(null);
      setLoading(false);
      return;
    }
    apiClient
      .getSessionStatus(sessionId)
      .then((value) => {
        setStatus(value);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [apiClient, sessionId]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh, refreshKey, sessionId]);

  return { status, loading, error, refresh };
}
