import type { LifecycleState } from './liveBadgeLogic.js';

/**
 * The dashboard's thin HTTP client against the orchestrator's API layer
 * (Plan M8/M9-M13). Deliberately dumb: every function here does request
 * building and response parsing only, mirroring
 * `orchestrator/src/modelserving_client/`'s and
 * `client-agent/src/eventSender.ts`'s own "thin RPC client" convention.
 * No caching, no retry policy, no business logic.
 */
export interface SessionStatus {
  readonly sessionId: string;
  readonly lifecycleState: LifecycleState;
  readonly hasAccommodationDisclosure: boolean;
}

export interface AggregateStatus {
  readonly totalSessions: number;
  readonly countsByState: Readonly<Record<string, number>>;
  readonly unknownRate: number;
}

export class ApiClientError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ApiClientError';
  }
}

export class DashboardApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
  }

  async getSessionStatus(sessionId: string): Promise<SessionStatus> {
    return this.getJson<SessionStatus>(`/sessions/${encodeURIComponent(sessionId)}/status`);
  }

  async getAggregateStatus(): Promise<AggregateStatus> {
    return this.getJson<AggregateStatus>('/sessions/aggregate');
  }

  async applyOverride(
    sessionId: string,
    nextState: LifecycleState,
    reason?: string,
  ): Promise<void> {
    await this.postJson(`/sessions/${encodeURIComponent(sessionId)}/override`, {
      nextState,
      reason,
    });
  }

  async recordAccommodationDisclosure(sessionId: string, reason: string): Promise<void> {
    await this.postJson(`/sessions/${encodeURIComponent(sessionId)}/accommodation-disclosure`, {
      reason,
    });
  }

  /** The SSE endpoint's URL for a session -- callers construct their own `EventSource` (a browser-provided API this client does not wrap, since it has no meaningful "response" for this thin-client layer to parse). */
  sessionEventsUrl(sessionId: string): string {
    return `${this.baseUrl}/sessions/${encodeURIComponent(sessionId)}/events`;
  }

  private async getJson<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`);
    } catch (error) {
      throw new ApiClientError(`Failed to reach the orchestrator at ${path}`, error);
    }
    if (!response.ok) {
      throw new ApiClientError(`Orchestrator responded with status ${response.status} for ${path}`);
    }
    return (await response.json()) as T;
  }

  private async postJson(path: string, body: unknown): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new ApiClientError(`Failed to reach the orchestrator at ${path}`, error);
    }
    if (!response.ok) {
      throw new ApiClientError(`Orchestrator responded with status ${response.status} for ${path}`);
    }
  }
}
