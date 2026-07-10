/**
 * Windowed event counting (RFC §9.5: emits a *count*, not raw event
 * content, per observation window — matching
 * `@sherlock/contracts`'s `DeviceEventCountValue` shape the orchestrator's
 * Device Bundle Adapter (Plan M10) expects). Pure, dependency-free logic
 * so it is trivially testable without a real browser environment; the
 * only browser-API-touching code in this package is `background.ts`,
 * which calls into this.
 */
export interface WindowedCount {
  readonly count: number;
  readonly windowMs: number;
}

export class WindowedEventAggregator {
  private readonly timestampsMs: number[] = [];

  constructor(private readonly windowMs: number) {
    if (!(windowMs > 0)) {
      throw new RangeError(`windowMs must be positive, received ${windowMs}`);
    }
  }

  record(atMs: number): void {
    this.timestampsMs.push(atMs);
  }

  /** The count of events recorded within the trailing window ending at `nowMs`, pruning anything older so memory does not grow unbounded across a long session. */
  countInWindow(nowMs: number): WindowedCount {
    const cutoff = nowMs - this.windowMs;
    let firstKeptIndex = 0;
    while (
      firstKeptIndex < this.timestampsMs.length &&
      (this.timestampsMs[firstKeptIndex] as number) <= cutoff
    ) {
      firstKeptIndex++;
    }
    if (firstKeptIndex > 0) {
      this.timestampsMs.splice(0, firstKeptIndex);
    }
    return { count: this.timestampsMs.length, windowMs: this.windowMs };
  }
}
