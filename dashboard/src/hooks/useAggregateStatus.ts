import { useCallback, useEffect, useState } from 'react';

import type { AggregateStatus, DashboardApiClient } from '../apiClient.js';

export function useAggregateStatus(apiClient: DashboardApiClient): {
  readonly aggregate: AggregateStatus | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const [aggregate, setAggregate] = useState<AggregateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    apiClient
      .getAggregateStatus()
      .then((value) => {
        setAggregate(value);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [apiClient]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { aggregate, loading, error, refresh };
}
