/**
 * Sends this window's Device/OS counts to the orchestrator (RFC §9.5:
 * "emit structured device/OS events over an authenticated connection to
 * the orchestrator, tagged with session_id, nothing else"). Plain
 * `fetch`, matching the orchestrator's own Model-Serving RPC client
 * (`orchestrator/src/modelserving_client/`) — no framework dependency for
 * a single POST call.
 */
export interface DeviceEvidencePayload {
  readonly consentGranted: boolean;
  readonly windowMs: number;
  readonly tabFocusChangeCount: number | null;
  readonly applicationSwitchCount: number | null;
  readonly clipboardPasteCount: number | null;
  readonly keyboardRhythmAnomalyCount: number | null;
}

export class EventSenderError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'EventSenderError';
  }
}

export interface EventSenderOptions {
  readonly orchestratorBaseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

export class EventSender {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EventSenderOptions) {
    this.baseUrl = options.orchestratorBaseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(sessionId: string, payload: DeviceEvidencePayload): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/sessions/${encodeURIComponent(sessionId)}/device-evidence`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
    } catch (error) {
      throw new EventSenderError('Failed to reach the orchestrator', error);
    }

    if (!response.ok) {
      throw new EventSenderError(`Orchestrator responded with status ${response.status}`);
    }
  }
}
