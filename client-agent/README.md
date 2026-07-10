# client-agent

The consented client-side capture agent (RFC §9.5, ADR-9; Plan M10): a
Manifest V3 browser extension emitting Device/OS Bundle F events (RFC
§4-F) to the orchestrator — tab-focus changes, application-switch events,
clipboard-paste events, and keyboard-rhythm _timing_ anomalies. It never
captures keystroke content or clipboard content, and never emits anything
without explicit, revocable consent.

## Modules

- `consent.ts` — `ConsentStore`: gates every capture path. Defaults to
  _not granted_ until the candidate explicitly opts in.
- `eventAggregator.ts` — `WindowedEventAggregator`: pure sliding-window
  event counting, pruned automatically so memory stays bounded across a
  long session.
- `keyboardRhythm.ts` — `KeyboardRhythmDetector`: an online-mean/variance
  (Welford's algorithm) anomaly detector over inter-keystroke _timing_
  only — never which keys were pressed.
- `eventSender.ts` — `EventSender`: posts one window's counts to the
  orchestrator's `POST /sessions/:id/device-evidence` endpoint (Plan M10).
- `background.ts` — the Manifest V3 service worker wiring `chrome.*`
  events into the modules above. Not unit-tested — it requires a real
  browser environment; the _decisions_ it wires together are tested, not
  the wiring itself (the same convention `orchestrator/src/index.ts` and
  `model-serving/src/model_serving/main.py` follow).

## Scope note

A companion content script (posting `paste`/`keydown` timing messages to
the background worker) is not included in this minimal package — see
`background.ts`'s own doc comment for the exact message contract it
expects. Building that content script is straightforward but adds no new
_logic_ beyond what's already tested here.

## Scripts

- `npm run build` — compile to `dist/`
- `npm run typecheck` — type-check without emitting
- `npm run test` — run the package's tests (Vitest)
