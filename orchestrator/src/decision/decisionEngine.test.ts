import type { EvidenceEvent } from '@sherlock/contracts';
import { describe, expect, it } from 'vitest';

import type { FusionPosterior } from '../fusion/index.js';
import type { LifecycleSessionRecord, LifecycleTransitionResult } from '../statemachine/index.js';
import { DecisionEngine, decideForSession } from './decisionEngine.js';
import type { DecisionInput } from './decisionEngine.js';

const T0 = new Date('2026-07-10T12:00:00.000Z');

function posterior(overrides: Partial<FusionPosterior> = {}): FusionPosterior {
  return {
    sessionId: 'session-1',
    evaluatedAt: T0,
    logOdds: 0,
    probability: 0.5,
    beta: { alpha: 1, beta: 1 },
    credibleInterval: { lower: 0.05, upper: 0.95, mass: 0.9 },
    bundleContributions: [],
    eligibleEventCount: 0,
    ...overrides,
  };
}

function record(state: LifecycleSessionRecord['state']): LifecycleSessionRecord {
  return { state, stateEnteredAt: T0, recoveryAnnotations: [], disqualificationAnnotations: [] };
}

function transition(
  state: LifecycleSessionRecord['state'],
  transitioned: boolean,
): LifecycleTransitionResult {
  return { record: record(state), transitioned, reason: 'test' };
}

function evidenceEvent(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    sessionId: 'session-1',
    bundle: 'claim',
    signalName: 'email_domain_match',
    healthStatus: 'OK',
    value: { matched: true, observedValue: 'a', claimedValue: 'a' },
    occurredAt: T0,
    recordedAt: T0,
    metadata: null,
    ...overrides,
  };
}

function input(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    sessionId: 'session-1',
    transition: transition('UNKNOWN', false),
    posterior: posterior(),
    evidence: [evidenceEvent()],
    now: T0,
    ...overrides,
  };
}

describe('decideForSession', () => {
  describe('DISQUALIFIED', () => {
    it('raises an URGENT alert and recommends MANDATORY_REVIEW on the transition into DISQUALIFIED', () => {
      const { decision } = decideForSession(
        input({ transition: transition('DISQUALIFIED', true) }),
        false,
      );

      expect(decision.reviewerRecommendation).toBe('MANDATORY_REVIEW');
      expect(decision.alert).not.toBeNull();
      expect(decision.alert?.severity).toBe('URGENT');
      expect(decision.abstained).toBe(false);
    });

    it('does not re-raise an alert on a later tick while holding at DISQUALIFIED', () => {
      const { decision } = decideForSession(
        input({ transition: transition('DISQUALIFIED', false) }),
        false,
      );

      expect(decision.reviewerRecommendation).toBe('MANDATORY_REVIEW');
      expect(decision.alert).toBeNull();
    });
  });

  describe('LOST_CONFIDENCE', () => {
    it('raises an INFO alert and recommends MONITOR on the transition into LOST_CONFIDENCE', () => {
      const { decision } = decideForSession(
        input({
          transition: transition('LOST_CONFIDENCE', true),
          posterior: posterior({ probability: 0.3 }),
        }),
        false,
      );

      expect(decision.reviewerRecommendation).toBe('MONITOR');
      expect(decision.alert?.severity).toBe('INFO');
    });

    it('does not re-raise an alert on a later tick while holding at LOST_CONFIDENCE', () => {
      const { decision } = decideForSession(
        input({
          transition: transition('LOST_CONFIDENCE', false),
          posterior: posterior({ probability: 0.3 }),
        }),
        false,
      );

      expect(decision.reviewerRecommendation).toBe('MONITOR');
      expect(decision.alert).toBeNull();
    });
  });

  describe('abstention (RFC §10) -- the only implemented policy', () => {
    it('abstains, unflagged, when UNKNOWN and probability is below the configured threshold', () => {
      const { decision } = decideForSession(
        input({
          transition: transition('UNKNOWN', false),
          posterior: posterior({ probability: 0.2 }),
        }),
        false,
      );

      expect(decision.abstained).toBe(true);
      expect(decision.reviewerRecommendation).toBe('DEFER_TO_ORDINARY_JUDGMENT');
      expect(decision.alert).toBeNull();
    });

    it('honors a custom abstentionProbabilityThreshold', () => {
      const { decision } = decideForSession(
        input({
          transition: transition('UNKNOWN', false),
          posterior: posterior({ probability: 0.4 }),
        }),
        false,
        { abstentionProbabilityThreshold: 0.3 },
      );

      // 0.4 >= 0.3, so no longer below the (lowered) threshold -> not abstaining.
      expect(decision.abstained).toBe(false);
    });

    it('does not abstain when UNKNOWN but probability happens to be at or above the threshold', () => {
      const { decision } = decideForSession(
        input({
          transition: transition('UNKNOWN', false),
          posterior: posterior({ probability: 0.6 }),
        }),
        false,
      );

      expect(decision.abstained).toBe(false);
    });

    it('never abstains from a non-UNKNOWN state, regardless of how low probability is', () => {
      const { decision } = decideForSession(
        input({
          transition: transition('LIKELY_CANDIDATE', false),
          posterior: posterior({ probability: 0.1 }),
        }),
        false,
      );

      expect(decision.abstained).toBe(false);
    });

    it('rejects a threshold outside [0, 1]', () => {
      expect(() =>
        decideForSession(input(), false, { abstentionProbabilityThreshold: 1.5 }),
      ).toThrow(RangeError);
    });
  });

  describe('tie-breaking / AMBIGUOUS -- needs adjudication (RFC §10)', () => {
    function ambiguousPosterior(): FusionPosterior {
      // Width 0.2, comfortably under the 0.3 default max -- not placed exactly at the boundary,
      // which is subject to ordinary floating-point representation error (e.g. 0.65 - 0.35 !==
      // 0.3 exactly in IEEE 754 double precision).
      return posterior({
        probability: 0.5,
        credibleInterval: { lower: 0.4, upper: 0.6, mass: 0.9 },
      });
    }

    it('flags ambiguous and recommends ADJUDICATE for a near-0.5, tight-interval posterior', () => {
      const { decision, ambiguousNow } = decideForSession(
        input({
          transition: transition('LIKELY_CANDIDATE', false),
          posterior: ambiguousPosterior(),
        }),
        false,
      );

      expect(decision.ambiguous).toBe(true);
      expect(ambiguousNow).toBe(true);
      expect(decision.reviewerRecommendation).toBe('ADJUDICATE');
      expect(decision.alert?.severity).toBe('INFO');
    });

    it('does not re-alert on a later tick that is still ambiguous (dedup)', () => {
      const { decision } = decideForSession(
        input({
          transition: transition('LIKELY_CANDIDATE', false),
          posterior: ambiguousPosterior(),
        }),
        true, // wasAmbiguous
      );

      expect(decision.ambiguous).toBe(true);
      expect(decision.alert).toBeNull();
    });

    it('re-alerts on re-entry into ambiguity after a tick that was not ambiguous', () => {
      const { decision } = decideForSession(
        input({
          transition: transition('LIKELY_CANDIDATE', false),
          posterior: ambiguousPosterior(),
        }),
        false, // wasAmbiguous=false, even though this is a "later" tick in spirit
      );

      expect(decision.alert).not.toBeNull();
    });

    it('is not ambiguous when the posterior is near 0.5 but the interval is wide (sparse, not confidently ambiguous)', () => {
      const sparse = posterior({
        probability: 0.5,
        credibleInterval: { lower: 0.05, upper: 0.95, mass: 0.9 },
      });
      const { decision } = decideForSession(
        input({ transition: transition('LIKELY_CANDIDATE', false), posterior: sparse }),
        false,
      );

      expect(decision.ambiguous).toBe(false);
    });

    it('is not ambiguous when the interval is tight but probability is far from 0.5', () => {
      const confident = posterior({
        probability: 0.9,
        credibleInterval: { lower: 0.8, upper: 0.98, mass: 0.9 },
      });
      const { decision } = decideForSession(
        input({ transition: transition('HIGHLY_CONFIDENT', false), posterior: confident }),
        false,
      );

      expect(decision.ambiguous).toBe(false);
    });
  });

  describe('RECOVERED', () => {
    it('raises an INFO alert (no mandatory action) on the transition into RECOVERED', () => {
      const { decision } = decideForSession(
        input({
          transition: transition('RECOVERED', true),
          posterior: posterior({ probability: 0.6 }),
        }),
        false,
      );

      expect(decision.alert?.severity).toBe('INFO');
      expect(decision.reviewerRecommendation).toBe('NONE');
    });

    it('does not re-alert on a later tick while remaining at RECOVERED', () => {
      const { decision } = decideForSession(
        input({
          transition: transition('RECOVERED', false),
          posterior: posterior({ probability: 0.6 }),
        }),
        false,
      );

      expect(decision.alert).toBeNull();
    });
  });

  describe('elicitationTrigger (Plan M11)', () => {
    it('recommends an unscripted_statement challenge on the transition into DISQUALIFIED', () => {
      const { decision } = decideForSession(
        input({ transition: transition('DISQUALIFIED', true) }),
        false,
      );

      expect(decision.elicitationTrigger).toMatchObject({ challengeType: 'unscripted_statement' });
    });

    it('does not repeat the elicitation trigger on a later tick while holding at DISQUALIFIED', () => {
      const { decision } = decideForSession(
        input({ transition: transition('DISQUALIFIED', false) }),
        false,
      );

      expect(decision.elicitationTrigger).toBeNull();
    });

    it('recommends a repeat_phrase challenge on first entry into confident ambiguity', () => {
      const ambiguous = posterior({
        probability: 0.5,
        credibleInterval: { lower: 0.4, upper: 0.6, mass: 0.9 },
      });
      const { decision } = decideForSession(
        input({ transition: transition('LIKELY_CANDIDATE', false), posterior: ambiguous }),
        false,
      );

      expect(decision.elicitationTrigger).toMatchObject({ challengeType: 'repeat_phrase' });
    });

    it('does not repeat the elicitation trigger on a later tick that is still ambiguous', () => {
      const ambiguous = posterior({
        probability: 0.5,
        credibleInterval: { lower: 0.4, upper: 0.6, mass: 0.9 },
      });
      const { decision } = decideForSession(
        input({ transition: transition('LIKELY_CANDIDATE', false), posterior: ambiguous }),
        true,
      );

      expect(decision.elicitationTrigger).toBeNull();
    });

    it('is null for unremarkable, ordinary operation', () => {
      const { decision } = decideForSession(
        input({
          transition: transition('LIKELY_CANDIDATE', false),
          posterior: posterior({
            probability: 0.8,
            credibleInterval: { lower: 0.6, upper: 0.95, mass: 0.9 },
          }),
        }),
        false,
      );

      expect(decision.elicitationTrigger).toBeNull();
    });

    it('is null for abstention (never escalates an insufficient-evidence session)', () => {
      const { decision } = decideForSession(
        input({
          transition: transition('UNKNOWN', false),
          posterior: posterior({ probability: 0.1 }),
        }),
        false,
      );

      expect(decision.elicitationTrigger).toBeNull();
    });
  });

  describe('normal operation', () => {
    it('recommends NONE and raises no alert for an unremarkable climbing-state tick', () => {
      const { decision } = decideForSession(
        input({
          transition: transition('LIKELY_CANDIDATE', false),
          posterior: posterior({
            probability: 0.8,
            credibleInterval: { lower: 0.6, upper: 0.95, mass: 0.9 },
          }),
        }),
        false,
      );

      expect(decision.reviewerRecommendation).toBe('NONE');
      expect(decision.alert).toBeNull();
      expect(decision.abstained).toBe(false);
      expect(decision.ambiguous).toBe(false);
    });
  });

  describe('immutable evidence references', () => {
    it('defensively copies the evidence array so later mutation of the caller array does not affect the decision', () => {
      const mutableEvidence = [evidenceEvent()];
      const { decision } = decideForSession(input({ evidence: mutableEvidence }), false);

      mutableEvidence.push(evidenceEvent({ signalName: 'calendar_invite_match' }));

      expect(decision.evidenceRef.events).toHaveLength(1);
    });

    it('carries the same posterior object by reference (read-only downstream, never mutated here)', () => {
      const p = posterior({ probability: 0.7 });
      const { decision } = decideForSession(input({ posterior: p }), false);

      expect(decision.evidenceRef.posterior).toBe(p);
    });

    it('every Decision carries an evidenceRef, even when abstaining or holding with no alert', () => {
      const { decision } = decideForSession(
        input({
          transition: transition('UNKNOWN', false),
          posterior: posterior({ probability: 0.1 }),
        }),
        false,
      );

      expect(decision.evidenceRef).toBeDefined();
      expect(decision.evidenceRef.sessionId).toBe('session-1');
    });
  });
});

describe('DecisionEngine', () => {
  it('dedupes ambiguous alerts across calls for the same session', () => {
    const engine = new DecisionEngine();
    const ambiguous = posterior({
      probability: 0.5,
      credibleInterval: { lower: 0.4, upper: 0.6, mass: 0.9 },
    });

    const first = engine.decide(
      input({ transition: transition('LIKELY_CANDIDATE', false), posterior: ambiguous }),
    );
    const second = engine.decide(
      input({ transition: transition('LIKELY_CANDIDATE', false), posterior: ambiguous }),
    );

    expect(first.alert).not.toBeNull();
    expect(second.alert).toBeNull();
  });

  it('keeps ambiguity dedup state fully isolated per session', () => {
    const engine = new DecisionEngine();
    const ambiguous = posterior({
      probability: 0.5,
      credibleInterval: { lower: 0.4, upper: 0.6, mass: 0.9 },
    });

    engine.decide(
      input({
        sessionId: 'session-a',
        transition: transition('LIKELY_CANDIDATE', false),
        posterior: ambiguous,
      }),
    );
    const otherSession = engine.decide(
      input({
        sessionId: 'session-b',
        transition: transition('LIKELY_CANDIDATE', false),
        posterior: ambiguous,
      }),
    );

    expect(otherSession.alert).not.toBeNull();
  });

  it('re-alerts after ambiguity resolves and then recurs', () => {
    const engine = new DecisionEngine();
    const ambiguous = posterior({
      probability: 0.5,
      credibleInterval: { lower: 0.4, upper: 0.6, mass: 0.9 },
    });
    const confident = posterior({
      probability: 0.9,
      credibleInterval: { lower: 0.8, upper: 0.98, mass: 0.9 },
    });

    engine.decide(
      input({ transition: transition('LIKELY_CANDIDATE', false), posterior: ambiguous }),
    );
    engine.decide(
      input({ transition: transition('LIKELY_CANDIDATE', false), posterior: confident }),
    );
    const third = engine.decide(
      input({ transition: transition('LIKELY_CANDIDATE', false), posterior: ambiguous }),
    );

    expect(third.alert).not.toBeNull();
  });

  it('honors custom options passed at construction', () => {
    const engine = new DecisionEngine({ abstentionProbabilityThreshold: 0.1 });
    const decision = engine.decide(
      input({
        transition: transition('UNKNOWN', false),
        posterior: posterior({ probability: 0.2 }),
      }),
    );

    // 0.2 >= 0.1 -> not below the (lowered) threshold -> no longer abstaining.
    expect(decision.abstained).toBe(false);
  });
});
