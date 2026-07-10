import { EventEmitter } from 'node:events';

import type { Decision } from '../decision/index.js';

/**
 * Publishes each session's `Decision` as it is produced, for the
 * dashboard's live push surface (Plan M13: "WebSocket/SSE client"). A
 * thin wrapper around `node:events`, scoped per-session so a subscriber
 * only ever receives events for the one session it asked about — no
 * cross-session leakage.
 *
 * This is deliberately a read-only side channel: nothing here can feed
 * back into the Fusion Engine, Lifecycle FSM, or Decision Engine — it
 * only observes already-finalized `Decision`s the same way `httpServer.ts`
 * already does for its synchronous responses.
 */
export class SessionEventBus {
  private readonly emitter = new EventEmitter();

  publish(decision: Decision): void {
    this.emitter.emit(decision.sessionId, decision);
  }

  subscribe(sessionId: string, listener: (decision: Decision) => void): () => void {
    this.emitter.on(sessionId, listener);
    return () => this.emitter.off(sessionId, listener);
  }
}
