/**
 * Public surface of `@sherlock/client-agent` (RFC §9.5, ADR-9; Plan M10).
 */
export type { ConsentStorage } from './consent.js';
export { ConsentStore, InMemoryConsentStorage } from './consent.js';

export type { WindowedCount } from './eventAggregator.js';
export { WindowedEventAggregator } from './eventAggregator.js';

export type { KeyboardRhythmOptions } from './keyboardRhythm.js';
export { KeyboardRhythmDetector } from './keyboardRhythm.js';

export type { DeviceEvidencePayload, EventSenderOptions } from './eventSender.js';
export { EventSender, EventSenderError } from './eventSender.js';

export { startAgent } from './background.js';
