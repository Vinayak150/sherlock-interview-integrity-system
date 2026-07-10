/**
 * The extension's background service worker — the one file in this
 * package that actually touches `chrome.*` APIs. Deliberately thin: it
 * only wires browser events into the pure, tested logic in
 * `eventAggregator.ts`/`keyboardRhythm.ts`/`consent.ts`/`eventSender.ts`,
 * exactly like `orchestrator/src/index.ts` and `model_serving/main.py` are
 * thin wiring over their own tested domain modules. Not unit-tested here
 * for the same reason `index.ts` isn't: it requires a real browser
 * environment (`chrome.tabs`, `chrome.storage`) that a Node-based test
 * runner cannot faithfully simulate — the *decisions* it wires together
 * are what's tested, not the wiring itself.
 *
 * RFC §9.5 scope, honored exactly: "clipboard, active-tab/app-focus,
 * keyboard-timing metadata, not keystroke *content*." No keystroke value
 * is ever read — only `performance.now()`-style timestamps. Clipboard
 * *content* is never read either — only the fact that a paste occurred
 * (a content-script `paste` listener would be required to observe paste
 * events within a page; the manifest's `clipboardRead` permission is
 * scoped narrowly to that detection, not to reading arbitrary clipboard
 * contents at will).
 */
import { ConsentStore } from './consent.js';
import { WindowedEventAggregator } from './eventAggregator.js';
import { EventSender } from './eventSender.js';
import { KeyboardRhythmDetector } from './keyboardRhythm.js';

const REPORTING_WINDOW_MS = 60_000;
const ORCHESTRATOR_BASE_URL = 'http://localhost:8080';

interface ChromeStorageLike {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

function chromeStorageAdapter(): ChromeStorageLike {
  return {
    async get(key: string): Promise<string | undefined> {
      const result = await chrome.storage.local.get(key);
      return result[key] as string | undefined;
    },
    async set(key: string, value: string): Promise<void> {
      await chrome.storage.local.set({ [key]: value });
    },
  };
}

export function startAgent(sessionId: string): void {
  const consentStore = new ConsentStore(chromeStorageAdapter());
  const tabFocusAggregator = new WindowedEventAggregator(REPORTING_WINDOW_MS);
  const appSwitchAggregator = new WindowedEventAggregator(REPORTING_WINDOW_MS);
  const clipboardAggregator = new WindowedEventAggregator(REPORTING_WINDOW_MS);
  const keyboardAnomalyAggregator = new WindowedEventAggregator(REPORTING_WINDOW_MS);
  const keyboardRhythmDetector = new KeyboardRhythmDetector();
  const eventSender = new EventSender({ orchestratorBaseUrl: ORCHESTRATOR_BASE_URL });

  chrome.tabs.onActivated.addListener(() => {
    tabFocusAggregator.record(Date.now());
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
      appSwitchAggregator.record(Date.now());
    }
  });

  // A companion content script (not included in this minimal package) would post
  // `{ type: 'sherlock-paste' }` / `{ type: 'sherlock-keydown', atMs }` messages here on
  // paste/keydown events -- never keystroke content, per the module doc comment above.
  chrome.runtime.onMessage.addListener((message: { type?: string; atMs?: number }) => {
    if (message.type === 'sherlock-paste') {
      clipboardAggregator.record(Date.now());
    } else if (message.type === 'sherlock-keydown' && typeof message.atMs === 'number') {
      if (keyboardRhythmDetector.recordKeydown(message.atMs)) {
        keyboardAnomalyAggregator.record(message.atMs);
      }
    }
  });

  setInterval(() => {
    void (async () => {
      const consentGranted = await consentStore.isGranted();
      const now = Date.now();

      await eventSender.send(sessionId, {
        consentGranted,
        windowMs: REPORTING_WINDOW_MS,
        tabFocusChangeCount: consentGranted ? tabFocusAggregator.countInWindow(now).count : null,
        applicationSwitchCount: consentGranted
          ? appSwitchAggregator.countInWindow(now).count
          : null,
        clipboardPasteCount: consentGranted ? clipboardAggregator.countInWindow(now).count : null,
        keyboardRhythmAnomalyCount: consentGranted
          ? keyboardAnomalyAggregator.countInWindow(now).count
          : null,
      });
    })();
  }, REPORTING_WINDOW_MS);
}
