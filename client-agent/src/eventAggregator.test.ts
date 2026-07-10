import { describe, expect, it } from 'vitest';

import { WindowedEventAggregator } from './eventAggregator.js';

describe('WindowedEventAggregator', () => {
  it('rejects a non-positive windowMs', () => {
    expect(() => new WindowedEventAggregator(0)).toThrow(RangeError);
  });

  it('returns a zero count with no recorded events', () => {
    const aggregator = new WindowedEventAggregator(60_000);
    expect(aggregator.countInWindow(1_000)).toEqual({ count: 0, windowMs: 60_000 });
  });

  it('counts events recorded within the window', () => {
    const aggregator = new WindowedEventAggregator(60_000);
    aggregator.record(1_000);
    aggregator.record(2_000);
    aggregator.record(3_000);
    expect(aggregator.countInWindow(10_000).count).toBe(3);
  });

  it('excludes events older than the window', () => {
    const aggregator = new WindowedEventAggregator(60_000);
    aggregator.record(0);
    expect(aggregator.countInWindow(61_000).count).toBe(0);
  });

  it('excludes an event exactly at the window boundary (strictly older than, not at, is kept)', () => {
    const atBoundary = new WindowedEventAggregator(60_000);
    atBoundary.record(0);
    expect(atBoundary.countInWindow(60_000).count).toBe(0);

    const justInsideBoundary = new WindowedEventAggregator(60_000);
    justInsideBoundary.record(0);
    expect(justInsideBoundary.countInWindow(59_999).count).toBe(1);
  });

  it('prunes stale events across successive calls, keeping memory bounded', () => {
    const aggregator = new WindowedEventAggregator(1_000);
    for (let i = 0; i < 100; i++) {
      aggregator.record(i * 100);
    }
    // Advance well past the window -- everything should be pruned.
    expect(aggregator.countInWindow(100_000).count).toBe(0);
  });

  it('reflects only recent activity as time advances (a sliding window, not a cumulative total)', () => {
    const aggregator = new WindowedEventAggregator(1_000);
    aggregator.record(0);
    aggregator.record(500);
    expect(aggregator.countInWindow(600).count).toBe(2);

    aggregator.record(1_600);
    // At t=1600 with a 1000ms window, the cutoff is 600 -- both the t=0 and t=500 events have
    // aged out, leaving only the newly recorded one.
    expect(aggregator.countInWindow(1_600).count).toBe(1);
  });
});
