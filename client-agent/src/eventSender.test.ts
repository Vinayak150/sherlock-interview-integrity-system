import { describe, expect, it, vi } from 'vitest';

import { EventSender, EventSenderError } from './eventSender.js';
import type { DeviceEvidencePayload } from './eventSender.js';

function payload(overrides: Partial<DeviceEvidencePayload> = {}): DeviceEvidencePayload {
  return {
    consentGranted: true,
    windowMs: 60_000,
    tabFocusChangeCount: 1,
    applicationSwitchCount: 0,
    clipboardPasteCount: 0,
    keyboardRhythmAnomalyCount: 0,
    ...overrides,
  };
}

function jsonResponse(ok: boolean, status = 200): Response {
  return { ok, status } as unknown as Response;
}

describe('EventSender', () => {
  it('posts to /sessions/:sessionId/device-evidence with the JSON payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(true));
    const sender = new EventSender({
      orchestratorBaseUrl: 'http://orchestrator.internal',
      fetchImpl,
    });

    await sender.send('session-1', payload());

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://orchestrator.internal/sessions/session-1/device-evidence',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(payload());
  });

  it('url-encodes the sessionId', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(true));
    const sender = new EventSender({ orchestratorBaseUrl: 'http://x', fetchImpl });

    await sender.send('session with spaces', payload());

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://x/sessions/session%20with%20spaces/device-evidence',
      expect.anything(),
    );
  });

  it('throws EventSenderError on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(false, 503));
    const sender = new EventSender({ orchestratorBaseUrl: 'http://x', fetchImpl });

    await expect(sender.send('session-1', payload())).rejects.toBeInstanceOf(EventSenderError);
  });

  it('throws EventSenderError when the transport itself fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const sender = new EventSender({ orchestratorBaseUrl: 'http://x', fetchImpl });

    await expect(sender.send('session-1', payload())).rejects.toBeInstanceOf(EventSenderError);
  });

  it('strips a trailing slash from the configured base URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(true));
    const sender = new EventSender({ orchestratorBaseUrl: 'http://x/', fetchImpl });

    await sender.send('session-1', payload());

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://x/sessions/session-1/device-evidence',
      expect.anything(),
    );
  });
});
