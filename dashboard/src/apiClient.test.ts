import { describe, expect, it, vi } from 'vitest';

import { ApiClientError, DashboardApiClient } from './apiClient.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('DashboardApiClient', () => {
  it('getSessionStatus fetches /sessions/:id/status and returns the parsed body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        sessionId: 'session-1',
        lifecycleState: 'CONFIRMED',
        hasAccommodationDisclosure: false,
      }),
    );
    const client = new DashboardApiClient('http://orchestrator.internal', fetchImpl);

    const status = await client.getSessionStatus('session-1');

    expect(status.lifecycleState).toBe('CONFIRMED');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://orchestrator.internal/sessions/session-1/status',
    );
  });

  it('getAggregateStatus fetches /sessions/aggregate', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ totalSessions: 3, countsByState: { UNKNOWN: 1 }, unknownRate: 0.33 }),
      );
    const client = new DashboardApiClient('http://x', fetchImpl);

    const aggregate = await client.getAggregateStatus();

    expect(aggregate.totalSessions).toBe(3);
    expect(fetchImpl).toHaveBeenCalledWith('http://x/sessions/aggregate');
  });

  it('applyOverride posts to /sessions/:id/override with the requested state and reason', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new DashboardApiClient('http://x', fetchImpl);

    await client.applyOverride('session-1', 'LOST_CONFIDENCE', 'reviewer cleared it');

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://x/sessions/session-1/override');
    expect(JSON.parse(init.body as string)).toEqual({
      nextState: 'LOST_CONFIDENCE',
      reason: 'reviewer cleared it',
    });
  });

  it('recordAccommodationDisclosure posts to /sessions/:id/accommodation-disclosure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new DashboardApiClient('http://x', fetchImpl);

    await client.recordAccommodationDisclosure('session-1', 'interpreter present');

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://x/sessions/session-1/accommodation-disclosure');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'interpreter present' });
  });

  it('sessionEventsUrl builds the SSE endpoint URL without making a request', () => {
    const client = new DashboardApiClient('http://x/');
    expect(client.sessionEventsUrl('session-1')).toBe('http://x/sessions/session-1/events');
  });

  it('throws ApiClientError on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
    const client = new DashboardApiClient('http://x', fetchImpl);

    await expect(client.getSessionStatus('session-1')).rejects.toBeInstanceOf(ApiClientError);
  });

  it('throws ApiClientError when the transport itself fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const client = new DashboardApiClient('http://x', fetchImpl);

    await expect(client.getAggregateStatus()).rejects.toBeInstanceOf(ApiClientError);
  });

  it('url-encodes the sessionId in every path', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new DashboardApiClient('http://x', fetchImpl);

    await client.getSessionStatus('session with spaces');

    expect(fetchImpl).toHaveBeenCalledWith('http://x/sessions/session%20with%20spaces/status');
  });
});
