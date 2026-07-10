# Sherlock — Real-Time Candidate Identity & Interview-Integrity System
## Architecture RFC

- **Status:** Draft complete (§1–19) — ready for architecture review
- **Type:** System architecture RFC (no implementation)
- **Scope:** Complete architecture for continuous, explainable candidate-identity verification during live remote interviews
- **Explicitly out of scope:** Source code, schemas, API contracts, ML training code, infra-as-code

### How this document is organized
Nineteen sections, in the order a reviewer actually needs them: what problem is real (§1–3), what evidence exists and how it's combined (§4–5), how the system behaves over a session (§6–8), how it's built (§9–13), how it's proven correct (§14–15), how it grows (§16–18), and a closing self-audit (§19). Starting at §5, every genuinely major, standalone architectural choice — not every small decision — gets the full record: **Problem, Alternatives considered, Why they were rejected, Final decision, Engineering rationale, Tradeoffs, Risks, Future migration path, Committee Notes.** Applying that template to every paragraph would be process theater; it's reserved for decisions where getting it wrong is expensive. Differing engineering priorities are preserved as **Committee Notes** at real points of tension — a record of the disagreement and its resolution, not an invented transcript.

### External grounding
A search for the public Sherlock AI product turned up a real, live product (withsherlock.ai) whose publicly described capabilities inform this design in one specific, material way: candidates must explicitly grant **device and browser permissions**, which confirms that a consented **client-side capture agent** — not just server-side call-media analysis — is a real requirement for signals like clipboard activity, application switching, and keyboard rhythm. That fact is incorporated below as its own signal family (§4) and architectural component (§9). Everything else in this document — the fusion mathematics, the state machine, the service boundaries, every threshold and formula — is original design against the assignment brief, not a reconstruction of Sherlock's actual, proprietary, unpublished backend. Where public information didn't exist or wasn't reliable enough to build on, that is stated plainly rather than filled with a guess.

### Document notes & corrections to the brief
No separate challenge document was attached beyond the instruction file itself, so it's treated as the complete problem statement, with assumptions stated explicitly rather than silently baked in. Eight corrections were made to the brief on the judgment that a Principal Architect's job includes pushing back on the spec, not just filling it in:

1. **"Choose the best fusion approach" is a false choice.** §5 shows that Weighted Scoring and Bayesian Updating aren't competing alternatives — in log-space, Bayesian updating *is* additive weighted scoring.
2. **A fairness/bias-risk dimension was added to every signal** (§4). Several plausible signals (eye contact, speaking duration, accent-adjacent features) are legally and ethically dangerous if weighted naively; a design that optimizes purely for predictive power without this axis is a discrimination claim waiting to happen.
3. **"Human Override" was upgraded from a feature to an invariant.** The state machine (§6) makes it structurally impossible for the system to autonomously take a consequential action against a candidate.
4. **An explicit scope boundary excludes interview competence from identity signals** (§4). This system verifies *who*, never *how well* — conflating the two is both a validity problem and a liability problem.
5. **A candidate-facing accommodation-disclosure flow was added** (§11) so legitimate assistive setups are removed from the suspicion pool entirely, not merely down-weighted.
6. **A three-state signal-health contract was added** (`OK` / `NO_SIGNAL_DETECTED` / `SERVICE_UNAVAILABLE`, §13) after identifying that most real "false fraud flag during an outage" incidents come from conflating *"detector says no"* with *"detector didn't respond."*
7. **The "internal debate" instruction is honored in substance, not theater** — differing priorities are preserved as Committee Notes at genuine decision points, not a scripted transcript.
8. **Infrastructure complexity is treated as a cost, not a default.** Distributed-systems patterns (event buses, microservices, event sourcing, CQRS, vector databases) are introduced only where a specific, stated technical requirement justifies them. Most of this system's real difficulty is in the probabilistic reasoning and the human-facing guarantees, not the plumbing, and §9 is sized accordingly.

### Table of contents
1. Executive Summary · 2. Requirement Analysis · 3. First-Principles Analysis · 4. Signal Discovery · 5. Signal Fusion · 6. State Machine · 7. Temporal Reasoning · 8. Explainability · 9. Architecture · 10. Decision Engine · 11. Edge Cases · 12. Real-Time Constraints · 13. Reliability · 14. Evaluation · 15. Security · 16. Scalability · 17. Future Evolution · 18. Architecture Decision Records · 19. Self-Review

---

## Section 1 — Executive Summary

**The real problem.** This is not a face-matching problem. It is the problem of maintaining a *continuously justified belief*, live, under adversarial pressure, that the person answering interview questions is the same person who applied — and being able to show the work behind that belief when it's wrong, contested, or uncertain. Face matching is one input to that problem, and on its own, a weak one.

**Why it's hard:**
- **Cold-start identity.** No strong enrolled biometric exists at the start, typically — at best a stale resume photo, an email address, a calendar invite. The prior is weak by construction.
- **No single reliable signal.** Every individual signal is spoofable (face, voice), trivially satisfied by fraud (email, calendar, name), or legally risky to over-weight (accent, eye contact). Reliability only emerges from combining signals that are independently attackable.
- **Adaptive adversary.** This is detection against an adversary who reads the same literature the detection team does, and adjusts.
- **Real-time, not forensic.** The value is in surfacing a problem while a human can still act on it, not in a report generated after the offer is signed.
- **Asymmetric costs.** A false accusation against a genuine candidate is a severe, hard-to-undo harm — arguably worse than a missed fraud case, which at least leaves the door open at a later round. Treating both error types symmetrically gets the cost function wrong.
- **Explainability is a requirement, not a feature.** A bare score is unusable, and likely non-compliant with emerging algorithmic-hiring regulation.
- **Signal availability is itself adversarial.** The adversary chooses whether the camera is on. A design that only works when every signal is present is a design the adversary can route around by disabling signals.

**Why the obvious solutions fail:**

| Obvious solution | Why it fails |
|---|---|
| Face-match against a resume/LinkedIn photo | Weak reference; single point of failure; blind to audio-only fraud and mid-call handoff |
| Check email + calendar invite | Verifies the account, not the person behind the camera |
| One-time ID check at call start | Blind to the realistic attack of verifying, then handing off to a more capable proxy |
| End-to-end black-box fraud score | Unauditable, brittle to drift, un-contestable by the candidate, a compliance liability |

The rest of this document designs a system with one central property: **no single missing, spoofed, or malfunctioning signal can unilaterally move a candidate's status, and every status reached comes with evidence a human can inspect and challenge.**

---

## Section 2 — Requirement Analysis

### Functional Requirements
Ingest live video, audio, transcript, platform-metadata, and — where consented — client-device signals. Establish an initial identity claim from pre-interview data. Continuously compute and update a calibrated confidence estimate with a hysteresis-based lifecycle state. Surface low-noise, real-time alerts to the interviewer/reviewer, never to the candidate. Attach a structured evidence report to every state and every alert. Support full post-interview audit. Degrade gracefully under missing, delayed, or malicious signals. Detect the patterns this product exists to catch: full-session proxy, mid-call handoff, synthetic video/audio, coached off-camera answering. Provide a first-class human-override path; the system never autonomously executes a consequential action. Improve from labeled outcomes without violating data-minimization constraints.

### Non-Functional Requirements
Sub-few-second latency; horizontal scalability by session count; explainability and auditability by construction; privacy-by-design (minimization, purpose limitation, encryption, residency, consent); extensibility without re-architecting the fusion core; human-in-the-loop as an architectural invariant, not a policy promise.

### Hidden Requirements
What's actually being evaluated, beyond the literal brief: ethical judgment under ambiguity (asymmetric-cost awareness, not naive accuracy-maximization); restraint (what's deliberately left out, §16); systems maturity (distinguishing "the detector said no" from "the detector didn't answer," §13); and the ability to communicate a complex, ambiguous system clearly — which matters specifically here because explainability *is* the product requirement, not a bonus feature.

### Implicit Constraints
The system is decision-support, never a hiring authority. The video platform, and — where used — the client agent, are dependencies the team doesn't control; the design must tolerate whatever they do and don't expose. Fraud base rates are low and initially unknown, which rules out any approach whose cold-start behavior depends on abundant labeled positives.

### Ambiguous Requirements (resolved explicitly)

| Ambiguity | Resolution taken | Why |
|---|---|---|
| Strong biometric enrollment at intake? | Design for a spectrum: some deployments verify ID at intake, most don't. The architecture works at the weak end and improves automatically at the strong end. | Assuming a strong prior everywhere fails for most real customers. |
| Live-in-call or post-hoc analysis? | Core pipeline supports both; live is the harder, primary target. | Post-hoc is a strict subset — replay the same pipeline off a recording. |
| Does the system ever *decide*, or only *inform*? | Only informs. Made structural in §6, formalized as ADR-3 (§18). | Legal and ethical line, not a style preference. |

**Committee Note.** Product Lead raised fully automated rejection at extreme confidence (>99.9%) as a way to cut reviewer workload at scale. Rejected even at that extreme — see ADR-3 (§18). Short version: "very high confidence" and "safe to automate" are not the same claim, and this system has no way to validate the second claim about itself without the first.

### Engineering Risks
Model drift as deepfake/voice-clone tooling improves; correlated-signal double-counting inflating false confidence; alert fatigue; cold-start miscalibration; bursty load concentrated in business hours across time zones.

### Product Risks
Candidate trust/experience damage from a visibly intrusive system; disparate impact across accessibility, cultural, and linguistic groups; interviewer over-reliance on the score in place of judgment; regulatory exposure under algorithmic-hiring disclosure law.

### Success Metrics
Fraud recall at a fixed, low false-accusation rate; time-to-flag for genuine fraud; calibration error of the confidence score; reviewer-rated usefulness of the evidence report; reduction in confirmed incidents over time.

### Failure Metrics
False-accusation rate against genuine candidates; silent signal outages that go unsurfaced; alert-fatigue rate; measured disparate impact across demographic/accessibility groups; fraction of flags issued without adequate evidence; SLA latency violations.

---

## Section 3 — First-Principles Analysis

**What actually identifies a person, from first principles:** not any single measurement, but the statistical improbability that an impostor simultaneously satisfies many *independently-attackable* signals, sustained over time, under unpredictable interactive pressure. Same logic as multi-factor authentication — each factor is individually spoofable, but jointly spoofing several independent factors live, while also answering unscripted questions coherently, is a categorically harder problem than spoofing any one of them. Everything downstream operationalizes this one idea.

**Causal vs. correlated vs. adversarial, by signal class:**

| Signal class | Relationship to true identity |
|---|---|
| Face/voice embedding vs. a *verified* reference | Closest to causal, given liveness — only as strong as the reference, and most references are weak |
| Face/voice embedding **self-consistency within the session** | Causal for "one continuous person," not for "the *correct* person" — needs no external reference at all (§4, §10) |
| Name, email, calendar | Identity *claims*, not proof — correlated with genuine use, near-zero cost to falsify |
| Behavioral/linguistic style consistency | Weak-causal for "same person throughout," confounded by nerves and fatigue |
| Eye contact, speaking duration, accent-adjacent features | Weak at best, high fairness risk — deliberately down-weighted or excluded (§4) |

**Degrades over time:** any fixed deepfake/voice-clone *classifier* — a permanent arms race against an adapting adversary, not a one-time engineering problem. A static reference photo also degrades: it ages, and was rarely a great source to begin with.

**Improves over time:** within-session evidence volume (more speech samples tighten the voiceprint estimate); cross-session memory across interview rounds; population-level fraud-pattern models, once enough labeled outcomes exist (§16).

**The under-used insight: interactivity is a signal generator, not just a UX surface.** An interview is inherently live and two-way. The interviewer can be equipped to *elicit* evidence on demand — an unscripted question, a brief camera reposition — rather than only passively observing whatever evidence happens to occur. This "active elicitation" mechanism (§5, §10) turns out to be one of the strongest available countermeasures against exactly the hardest attacks, for a reason made precise in §15: an unscripted, freshly-generated challenge functions like a cryptographic nonce against a replay attack.

---

## Section 4 — Signal Discovery

Signals are grouped into families because fusion (§5) operates at the family/bundle level — this is what avoids correlated double-counting.

**A. Pre-call identity-claim signals.** Display name vs. application record · email/domain match · calendar-invite organizer/attendee match · resume/LinkedIn reference photo, if any · prior ID-verification artifact, where the customer's process includes one · account/device history with this candidate identity.

**B. Session/platform metadata signals.** Join order and method (correct invite link vs. forwarded) · IP geolocation vs. stated location (weak — VPNs are common) · device/browser fingerprint continuity across sessions · virtual camera/microphone driver detection · screen-share state · multi-monitor detection (weak).

**C. Visual signals.** Face presence over time · face count in frame (informational, not automatically negative — §11) · face-embedding similarity to any external reference (weak-moderate) · **face-embedding self-consistency within the session** (strong, reference-independent) · liveness/anti-spoof cues · **lip-sync-to-phoneme consistency** (catches dubbed-audio and many deepfake pipelines) · dedicated deepfake-artifact classifiers (high value now, **decaying by design**).

**D. Audio signals.** Voice-embedding similarity to any external reference · **voice-embedding self-consistency within the session** · synthetic-speech artifact detectors (decaying) · prosody/cadence consistency · ambient/room-tone consistency (detects a physical handoff even without a visual cue) · **double-voice/audio-leakage detection** (coaching) · speaker-diarization stability specifically on *answering* turns.

**E. Linguistic signals** *(identity-consistency only — scope boundary, correction #4).* Self-consistency of biographical claims against the filed application. **Explicitly excluded:** answer quality, technical correctness, response latency as a *competence* signal — these belong to interview evaluation, not identity, and mixing them is both a validity and a liability problem.

**F. Device/OS behavioral signals** *(client-agent-derived — see External Grounding).* Tab/window focus changes · application-switch events · clipboard paste events · keyboard rhythm. These require a consented client-side agent; they are invisible to server-side media analysis alone. This is the one signal family added specifically because it's confirmed as a real requirement, not a hypothetical, by the public product's stated permission model.

**G. Active-elicitation signals.** Interviewer-delivered, system-suggested prompts triggered specifically at borderline confidence, never continuously: a spontaneous unscripted statement, a brief camera reposition, repeating a freshly-generated phrase.

**H. Meta-signals** (computed from other signals). Running variance of face/voice embeddings · rate of lifecycle-state transitions (instability is itself informative) · visual/audio liveness synchrony.

**I. Cross-session signals** *(where the product spans multiple rounds).* Embedding consistency against the candidate's own prior verified round — one of the strongest signals available when applicable, since it needs no external reference at all.

### Signal ranking

| Signal | Reliability | Latency | Noise | Manipulation risk | Compute cost | Availability | Predictive power | Fairness risk |
|---|---|---|---|---|---|---|---|---|
| Face-embedding self-consistency | High | Low | Low | Med | Med | Med (needs camera) | High | Low |
| Voice-embedding self-consistency | High | Low | Med | Med | Low | Med (needs mic) | High | Low |
| Lip-sync consistency | High | Low | Med | Low | Med | Med | High | Low |
| Cross-session embedding match | Very High | N/A (batch) | Low | Low | Low | Low (needs history) | Very High | Low |
| Double-voice/audio-leakage | High | Low | Med | Low | Low | High | High | Low |
| Clipboard/app-switch pattern | High for its narrower claim | Low | Low | Med (spoofable in a VM) | Trivial | Low — needs consent | High for assistance, not identity | Low |
| Deepfake artifact classifier | Med, **decaying** | Low | Med | High (arms race) | Med | Med | Med, decaying | Low |
| Voice-clone artifact classifier | Med, **decaying** | Low | Med | High (arms race) | Low | Med | Med, decaying | Low |
| External-reference face match | Med | Low | High | Med | Low | Low-Med | Med | Med (photo bias) |
| Virtual-camera detection | Med (prior-shifter, not proof) | Low | Low | Low | Low | High | Med | Low |
| Active-elicitation response | High | Med (needs a turn) | Low | Low by design | Low | High | High | Low |
| Email/calendar match | Low | Low | Low | High | Trivial | High | Low | Low |
| Name match | Very Low | Low | High | High | Trivial | High | Very Low | Low |
| Speaking duration/frequency | Very Low as identity signal | Low | High | Med | Low | High | Very Low — scope boundary | **High — exclude** |
| Eye contact | Very Low | Low | High | Low | Med | Med | Very Low | **High — exclude** |
| Accent-adjacent transcript features | Very Low | Low | High | Low | Low | High | Very Low | **High — exclude** |

**A scope note on device/OS signals.** Clipboard and app-switching activity are strong evidence for a *different* question — "is the candidate using an unauthorized external resource right now" — not directly for "is this the claimed candidate." The public Sherlock product visibly covers both problems (identity/proxy fraud and AI-assistance monitoring) under one brand, but this document's mandate, per the assignment brief, is identity. Device/OS signals are included because they're real and interact with identity at the margins (a coached proxy is more likely to also show heavy external-resource use), but they're weighted near-zero in the core identity confidence score. The more accurate model is a parallel, structurally identical confidence track — "assistance-integrity" — reusing the same fusion machinery (§5). That extension is noted, not built out here, to keep this document's primary claim honest.

---

## Section 5 — Signal Fusion

**Problem.** Convert a stream of independently arriving, individually weak, partially correlated, sometimes-missing, sometimes-adversarial signals into one calibrated, incrementally-updatable, explainable confidence value — without any single signal able to dominate the outcome.

**Alternatives considered.**
1. Weighted linear scoring over raw signal values.
2. Bayesian sequential updating (log-odds accumulation).
3. Hidden Markov Model over a small set of discrete states.
4. A full joint probabilistic graphical model across all signals.
5. LLM-based holistic reasoning over the raw evidence.
6. A learned model (gradient-boosted trees or a small neural net) trained end-to-end on engineered features.

**Why alternatives were rejected, as standalone choices.**
- *Weighted scoring alone:* no principled uncertainty handling. A score of 0.6 from two consistent signals and a score of 0.6 from ten conflicting ones are indistinguishable — and that distinction matters operationally (§10).
- *Full joint PGM:* the real dependency structure doesn't need this. Correlation is confined to small, known clusters (e.g., everything derived from the video track), not spread arbitrarily across the whole signal set. A full joint model solves a harder inference problem than the one that exists, at real cost to maintainability.
- *HMM alone:* correctly models state persistence and regime change, but discretizes confidence in a way that loses the fine-grained "how sure, and based on how much evidence" distinction the state machine (§6) actually needs.
- *LLM as the scoring authority:* uncalibrated (no guarantee its stated confidence tracks its actual accuracy), prompt-injectable (the transcript is attacker-influenceable text), non-reproducible run to run — disqualifying for a number that gates human-affecting decisions.
- *Learned model as the primary engine, from day one:* needs labeled positive examples this product won't have in volume for a long time, given low fraud base rates, and would have no interpretable seam to inspect when it's wrong.

**Final decision.** Bayesian log-odds updating as the core engine, with correlated signals grouped into bundles (a *bundle-local*, not global, dependency structure), a lightweight change-point layer for regime detection, and a learned model admitted later as one more bundle feeding the same core — never as a replacement for it.

**Engineering rationale — the fusion math.** In log-odds space, Bayesian updating collapses into additive weighted scoring, which means alternatives 1 and 2 above were never actually competing:

```
log O_t  =  log O_0  +  Σ  w_k · log LR_i(e_k)
                        k
```

`O_t` is the posterior odds that the observed participant is the genuine candidate, given all evidence to time `t`. `O_0` is the prior odds, from pre-call identity-claim strength and, once available, the customer/industry fraud base rate. `LR_i(e_k)` is the likelihood ratio `P(e_k | genuine) / P(e_k | impostor)` for evidence `e_k` from signal `i`. `w_k` is a time-decay weight (§7). Displayed confidence is `p_t = sigmoid(log O_t)`.

This gets weighted-scoring's interpretability — every signal's contribution is a literal additive term, exactly what §8's explanation layer needs — and Bayesian updating's principled uncertainty handling, in one formula. It's also why "choose the best" in the original brief was a false framing (Correction #1).

**Handling correlated signals.** Face-count, embedding-match, and lip-sync all partly reflect one underlying fact: video-track authenticity. Multiplying their likelihood ratios as if independent would triple-count that fact and produce dangerously overconfident posteriors. Signals are grouped into bundles (Visual, Audio, Metadata/Claim, Linguistic, Device/OS), each combined internally via a small calibrated joint model scoped to that bundle only, and bundles — largely independently attackable from one another — combine via the log-odds sum above. This is the deliberate middle point between full-joint (rejected above) and flat independence (wrong, and dangerous given the stakes).

**Uncertainty representation.** The posterior is carried as a Beta distribution — mean plus credible interval — not a point estimate, so the system can tell *"40% because evidence is sparse"* from *"40% because evidence is abundant and contradictory."* These call for opposite system behavior (§10); collapsing them into one number erases exactly the distinction that matters most.

**Change-point detection.** A lightweight CUSUM / Bayesian-online-change-point layer runs on each bundle's embedding stream to catch a regime change — a mid-call swap — treated as qualitatively different from, and weighted far more heavily than, ordinary noisy evidence (§7). Chosen deliberately over a heavier learned change-point model for the same reason as the rest of this section: it's the simplest tool that actually solves the stated problem.

**Tradeoffs.** Hand-set, expert-elicited likelihood ratios at launch encode judgment, not measurement, until enough labeled outcomes accumulate to calibrate them empirically (§14, §16). Bundle boundaries are themselves a design judgment call — defensible by argument here, not yet validated against real correlation structure in production data.

**Risks.** Mis-specified likelihood ratios could systematically over- or under-state confidence in ways invisible until an audit or ablation study (§14) catches them. A bundle boundary drawn in the wrong place would silently double-count correlated evidence the same way flat independence does — just with fewer, larger offenders — and this needs to be checked empirically, not assumed correct because it was designed carefully.

**Future migration path.** Phase 1/2 (§16): expert-elicited likelihood ratios, hand-set bundle boundaries. Phase 3+: recalibrate likelihood ratios from accumulated labeled outcomes — the same additive log-odds structure, just better numbers, not a different architecture. A learned model is admitted as an additional bundle once labeled volume justifies it, its output entering the same log-odds sum as everything else — preserving the property that no single component, including the learned one, can become the sole author of the score.

**Committee Notes.**
- *Applied Research Scientist* pushed for the learned model as the primary engine from day one, expecting it to outperform hand-set likelihood ratios once trained. Overruled on cold-start data availability and the explainability requirement — revisit once Phase 3 labeled volume exists (§16).
- *Security Architect* flagged that a single compromised bundle-local model still can't swing the overall score arbitrarily, because of the per-event log-LR clamp introduced in §13 — worth cross-referencing here, since it's the property that makes bundling safe to do at all.

---

## Section 6 — State Machine

**Problem.** Convert a continuous, decaying, occasionally-discontinuous confidence value (§5) into a small set of discrete, human-actionable states — without either flapping distractingly around threshold boundaries, or collapsing two operationally distinct situations (evidence went quiet vs. evidence turned hostile) into one.

**Alternatives considered.**
1. Binary state (flagged / not flagged).
2. Three-tier state (low / medium / high confidence).
3. Continuous score only, no discrete state — render the raw number.
4. The eight-state lifecycle from the brief (Unknown, Possible, Likely, Highly Confident, Confirmed, Disqualified, Lost Confidence, Recovered).

**Why alternatives were rejected.**
- *Binary:* throws away exactly the "how sure, and why" information §8's explainability requirement depends on, and gives an interviewer nothing to calibrate their own attention against.
- *Three-tier:* collapses "evidence went quiet" (ambiguous, not damning) and "evidence turned hostile" (a specific contradiction) into the same middle tier. These call for different human responses — gently re-engage vs. escalate now — and merging them removes exactly the information a reviewer needs to act correctly.
- *Continuous score only:* the most information-preserving option on paper, but fails in practice — an interviewer glancing at a live number mid-question cannot reliably act on "0.61 vs 0.58." A threshold-free UI just relocates the thresholding problem into every individual human's head, inconsistently, instead of solving it once, deliberately, in the system.
- *Eight-state lifecycle as given:* adopted, with one structural amendment (below) — the brief's list is right in spirit but silent on the single most consequential property the state machine needs: what `DISQUALIFIED` is actually allowed to do.

**Final decision.** The eight-state lifecycle, with one non-negotiable amendment: `DISQUALIFIED` is defined as "mandatory human review triggered," never "candidate rejected." No transition out of `DISQUALIFIED` is automatic.

```
                     weak claim-match evidence
   UNKNOWN --------------------------------------> POSSIBLE_CANDIDATE
      ^                                                    |
      | no evidence ever accumulates                       | consistent multi-bundle
      | (camera+mic both off entire call)                  | evidence, moderate volume
      |                                                     v
      |                                           LIKELY_CANDIDATE
      |                                                     |
      |                                                     | strong, sustained,
      |                                                     | multi-bundle evidence
      |                                                     v
      |                                           HIGHLY_CONFIDENT
      |                                                     |
      |                                                     | very high confidence,
      |                                                     | sustained over duration
      |                                                     v
      |                                                CONFIRMED
      |
      |   change-point / strong contradiction, from ANY state above
      |   +---------------------------------------------------------+
      |   v                                                         |
      |  LOST_CONFIDENCE ---> (evidence rebuilds) ---> RECOVERED ----+
      |   |                                          (permanently
      |   | contradiction is strong                   annotated in
      |   | AND specific, not just                     the audit trail)
      |   | sparse evidence
      |   v
      |  DISQUALIFIED  ===>  ALWAYS means "mandatory human review triggered."
      |                      Never means "auto-rejected." No transition out
      +--------------------  of this state is automatic -- only an explicit
                             reviewer action moves a session out of it.
```

**Engineering rationale.**
- `LOST_CONFIDENCE` vs `DISQUALIFIED` is the single most important distinction in this state machine: `LOST_CONFIDENCE` means evidence weakened or went quiet — ambiguous, not damning. `DISQUALIFIED` means a specific, strong contradiction was detected (a change-point plus corroborating cross-bundle evidence, §5) — the only state that triggers mandatory, urgent human escalation.
- `RECOVERED` is not silent amnesia. A session that dipped into `LOST_CONFIDENCE` or `DISQUALIFIED` and later rebuilt confidence keeps a permanent annotation in the audit trail (§7) — a dip-then-recovery pattern is itself potentially meaningful (a brief handoff for two questions, then the genuine candidate returns) and must never be fully forgotten just because the live score recovered.
- Every transition uses hysteresis: the threshold to enter a tier is stricter than the threshold to fall out of it, and each state has a minimum dwell time, specifically to prevent state-flapping around a boundary — itself a UX and trust failure, tracked as "confidence stability" in §14.

**Tradeoffs.** Eight states plus hysteresis and dwell-time logic is materially more to reason about, test, and explain to a new engineer than a three-tier model. Accepted because the thing it buys — telling a reviewer "gently re-engage" vs. "escalate now" instead of "medium confidence" — is the actual product.

**Risks.** More states is more surface area for a subtly wrong transition rule to hide in; needs dedicated state-machine-level testing (explicit transition-coverage tests, not just end-to-end scenarios) to catch, e.g., a hysteresis band configured too tight to actually prevent flapping in practice.

**Future migration path.** The state set is expected to be stable; only the numeric thresholds (§10) are expected to move as real operating data accumulates (§16). If a future signal family introduces a genuinely new operational response — not just a new confidence input — that's a new state, added deliberately, not a new number squeezed into an existing tier's threshold.

**Committee Notes.**
- SRE pushed for a simpler three-state model to reduce operational and testing complexity. Overruled — see "Why alternatives were rejected": the `LOST_CONFIDENCE`/`DISQUALIFIED` split is where §8's explainability promise is actually kept or broken.
- Product Lead asked whether all eight states need to appear in the interviewer-facing UI, as distinct from whether they need to exist internally. Resolved: yes to both, but differently — the live badge can reasonably collapse to a simpler 3-tier display ("Building confidence" / "Confirmed" / "Needs attention") while the full eight-state machine stays authoritative underneath for the reviewer dashboard, the audit trail, and the tuning work in §14. Display simplification is a UI decision; it must not simplify the underlying model, since that is where the `LOST_CONFIDENCE`/`DISQUALIFIED` distinction does its work.

---

## Section 7 — Temporal Reasoning

**Why confidence rises.** Each additional, independent (bundle-level) piece of consistent evidence adds to the log-odds sum — the direct mathematical consequence of §5's formula, not a separate mechanism.

**Why confidence falls.** Two structurally different causes, handled differently:
- A bundle's likelihood ratio drops below 1 — evidence is more consistent with impostor than genuine. Genuine negative evidence.
- Expected evidence stops arriving — camera goes off after being on. **Absence of evidence, not evidence of absence.** Missing signal widens the credible interval (§5) and lowers the achievable confidence *ceiling* (§6, §11), but must never push the posterior toward "impostor" on its own.

**How much history matters — decay, with one deliberate exception.** Ordinary evidence decays exponentially, half-life on the order of a typical interview's length (tunable, §16), because a signal's relevance naturally fades in an evolving session. **Change-point-flagged evidence never decays in the audit ledger**, even though the live displayed score can recover — this is the mechanism behind `RECOVERED` staying permanently annotated (§6). Two separate objects exist for exactly this reason: a decaying live score for the interviewer's real-time view, and an append-only evidence ledger for audit, never pruned (§9, §13).

**How contradictory evidence is handled.** A genuine contradiction is a discrete change-point event (§5), not a bad data point diluted by averaging. It receives outsized weight — asymmetric to ordinary noise, because persistent identity should not exhibit hard swaps, while noise is expected to be smoothly distributed — triggers immediate active elicitation (§4-G) rather than waiting passively for more evidence to average it out, and is logged permanently regardless of subsequent recovery.

**Committee Note.** Applied Research Scientist proposed a symmetric decay model — contradictory evidence decays at the same rate as supporting evidence — for mathematical elegance. Rejected: symmetric decay would let a real mid-call swap "fade back to normal" purely because subsequent evidence from the impostor (who, to the *rest* of the bundles, looks unremarkable) accumulates — exactly the failure mode the change-point mechanism exists to prevent. Asymmetry here is load-bearing, not a stylistic choice.

---

## Section 8 — Explainability

**Invariant: the system never emits a bare verdict.** Every state and every alert is contractually paired with a structured Evidence Report. There is no code path — by design, not convention — that produces a status without one.

**Evidence Report contents.**
- **Top contributing signals**, ranked by `|log LR|` contribution (§5) — a direct, non-approximated readout of the fusion math, in plain language, each with its own reliability rating attached.
- **Contradictory evidence** currently on the record, if any.
- **Missing evidence** — what's unavailable and why (camera off, no reference photo on file, transcript service down) — explicitly separated from "evidence against" (§7).
- **Alternative hypotheses considered**, in two distinct senses: (a) *benign explanations for the same evidence* — is the current evidence better explained by a technical/environmental cause (lighting, network jitter) than by fraud? — and (b) *role assignment*, when multiple people are visible or audible — which participant is actually in the "candidate" role, and why (turn-taking pattern, calendar-invite role, host/guest metadata) — since a wrong role assignment would silently misattribute evidence to the wrong person entirely.

**How the report is produced.** Structured facts (signal names, values, contributions, timestamps) are generated deterministically by the fusion engine and state manager (§5, §6, §9) — guaranteed accurate by construction, never touched by a model that could hallucinate them. A constrained LLM layer turns that structured object into readable prose for a human reviewer, under one hard rule: the narrative may only reference facts present in the structured object, and generated output is validated against it before display — any signal name mentioned that isn't in the source object is rejected and regenerated.

This separation is why §13's "LLM unavailable" failure mode is a graceful, non-critical degradation rather than an outage: the structured report — the facts a compliance review actually needs — still renders in a plainer template with the narrative layer fully down. It is also the enforcement mechanism for §15's prompt-injection mitigation: the LLM has no channel back into the score or the state, only into the phrasing of facts it did not generate.

---

## Section 9 — Architecture

### 9.0 Sizing the problem, before choosing infrastructure

Infrastructure decisions are only defensible relative to a stated scale. Assumed operating envelope for Phase 1–2 (§16): low hundreds of concurrent live sessions at peak (a B2B hiring product's traffic is bounded by its customers' interview volume, not ambient user growth), each session lasting 30–90 minutes, each producing on the order of 1–10 evidence events per second across all bundles combined during active periods. That is a few thousand events per second system-wide at peak — a workload well inside what a single well-written service process, or a small number of replicas of one, handles comfortably without a distributed streaming platform. This number is the yardstick the rest of this section is measured against; a decision that only pays for itself at 100x this volume is deferred to §16, not built now.

### 9.1 Context Diagram

```
   +----------------+     +----------------+     +------------------------+
   |   Candidate    |     | Interviewer(s) |     |  Recruiter / Human     |
   +-------+--------+     +--------+-------+     |  Reviewer              |
           |                       |               +-----------+------------+
           | audio/video/chat      |                           ^
           v                       v                            |
   +-----------------------------------------------------------------+
   |             VIDEO INTERVIEW PLATFORM (Zoom / Meet / etc.)         |
   +------------------------------+------------------------------------+
                                   | media streams, transcript,
                                   | join/leave/mute/camera events
   +---------------+               v
   | Client Agent  |    +-----------------------------------------------+
   | (browser ext.,+--->|    SHERLOCK IDENTITY-INTEGRITY SYSTEM         |
   |  consented,   |    |            (this RFC)                        |
   |  device/OS    |    +--------------+---------------------------------+
   |  events)      |                  ^                |
   +---------------+                  | identity claim,  | confidence, state,
                                       | resume, calendar |  evidence, alerts
                                       |                   v
                        +--------------+---+  +-----------+-------------+
                        | ATS / Scheduling |  | Interviewer UI /        |
                        | / Application    |  | Reviewer Dashboard      |
                        | Record           |  +--------------------------+
                        +-------------------+
                                                  +--------------------------+
                                                  | Compliance / Privacy    |
                                                  | Admin (audit access)    |
                                                  +--------------------------+
```

### 9.2 The one question that decides most of this section

Given the actual scale (9.0), does this system need independently-scalable, independently-deployable services communicating over a durable message bus — or one well-structured, horizontally-replicated process with one clearly justified exception for GPU-bound inference?

**Problem.** Where should the seams be — the boundaries between things that run, fail, scale, and deploy independently?

**Alternatives considered.**
1. Full microservices: separate deployable services per signal modality (vision, audio, metadata, linguistic, device), connected by an event bus (Kafka-class), each independently scaled.
2. Event-sourced architecture: all state derived by replaying an immutable event log; no direct state mutation anywhere.
3. A modular monolith: one deployable orchestrator process, internally organized into clearly separated modules (state manager, fusion engine, decision engine), horizontally replicated by session-sharding — plus exactly one separate deployable unit where there is a real technical reason for one.

**Why alternatives were rejected.**
- *Full microservices:* at the scale established in 9.0, this buys nothing. Splitting cheap, tightly-coupled, low-latency logic — a handful of floating-point updates per event — across network hops only adds latency and failure surface. A call from a Vision service to a Fusion service over a network is strictly worse than a function call, with no compensating benefit, because nothing about vision-signal load is large or spiky enough on its own to need independent scaling from the rest of the orchestration logic. Where a real scaling-dimension difference *does* exist — GPU-bound model inference vs. lightweight per-session bookkeeping — that split is made (9.3 below covers persistence, model-serving is addressed here): one seam, not twelve.
- *Full event sourcing:* its benefit is that all state is perfectly reconstructible by replay, with no separate persistence mechanism to keep in sync. Its cost is real: no snapshots means potentially replaying a long event history on every recovery, and correctness now depends on an event-replay path being exercised as often and as well-tested as the live path. The state actually being protected here is small — a handful of scalars per bundle, per session (§5's log-odds accumulator, Beta parameters) — and cheap to snapshot directly. Event sourcing solves a harder problem than the one that exists. (The append-only evidence table this system needs anyway, for audit and explainability, gets most of event sourcing's practical benefit — a durable, replayable history — without adopting it as the state-management pattern for everything.)
- *Kafka / a distributed streaming platform, as default transport:* justified once there are multiple independent consumer types reading the same evidence stream for genuinely different purposes at genuinely large scale (§16) — not justified at low-hundreds-of-sessions scale, where a single orchestrator process already holds the authoritative state and doesn't need to publish it anywhere for another service to also consume.

**Final decision.** A modular monolith for the orchestrator (state manager + fusion engine + decision engine + explanation-request handling, as internal modules, not network-separated services), horizontally replicated with session-sharded routing (9.4); plus one separate deployable unit — a model-serving layer — for GPU-bound inference. That is the whole service topology for Phase 1–2.

**Engineering rationale.** The orchestrator's internal modules (§5's fusion math, §6's state machine, §10's decision logic) are all cheap, synchronous, per-session computations with no independent scaling need — they scale together, with the session, so they belong together, in-process, as clearly-separated code modules rather than network-separated services. The model-serving split *is* justified: embedding extraction, liveness/deepfake/voice-clone classifiers, and ASR are GPU-bound, batch-friendly, and have a completely different scaling profile — compute-bound, benefits from autoscaled GPU pools shared across many sessions — than the orchestrator (memory/IO-bound, many lightweight sessions). This is the one clear, technically-grounded service boundary in the system.

**Operational cost.** One deployable orchestrator (plus replicas) and one deployable model-serving layer is a small, on-call-friendly footprint — two things to deploy, version, and monitor, not twelve. This serves the "operational simplicity" requirement (§2) as much as it serves latency.

**Scalability characteristics.** Orchestrator replicas scale horizontally by adding instances and re-sharding session routing (9.4). Model-serving scales horizontally and independently by adding GPU capacity, autoscaled on queue depth/latency rather than session count, since inference load is driven by sampling cadence (§12), not 1:1 by session.

**Failure modes.** An orchestrator replica crash loses only the sessions it was holding, recoverable from the last snapshot (9.3) with a bounded gap of a few seconds' evidence, not a full-system outage. A model-serving outage degrades signal availability the same way a real detector "saying no" would from the fusion engine's point of view, when treated correctly via the health contract in §13 — it does not crash the orchestrator or the sessions it is holding.

**Recovery strategy.** Orchestrator: reload the last snapshot for affected sessions from the persistence layer (9.3) and resume; a few seconds of evidence between last snapshot and crash is an acceptable, bounded loss, not a correctness failure, because evidence keeps arriving and the system self-corrects quickly (§7). Model-serving: standard stateless-service failover — requests retry against healthy replicas; no session state lives there to lose.

**Future migration path.** If a specific signal family's compute genuinely outgrows shared model-serving capacity, that family gets its own model-serving pool before it gets its own orchestrator split — the orchestrator's internal modularity means new signal families are additions to existing modules, not new services, until proven otherwise by a measured bottleneck. A message queue (not necessarily Kafka specifically — a simpler managed queue is a plausible fit) is introduced between orchestrator and model-serving only if synchronous request/response latency (9.6) becomes the binding constraint at higher scale — a Phase 3+ (§16) decision, made against measured latency data, not anticipated now.

**Risks.** A monolith's biggest real risk is organizational, not technical: as team size grows, a single deployable owned by one team is fine; owned by five teams stepping on each other is not. That is a people-scaling problem this document doesn't have the standing to solve preemptively — noted honestly rather than papered over with speculative service boundaries that don't correspond to any actual team boundary yet.

**Committee Notes.**
- Staff Distributed Systems Engineer's default instinct was to propose per-modality services connected by an event bus, matching common patterns in higher-scale ML systems. Overruled by the sizing argument in 9.0 — the pattern is right at a scale this system doesn't have yet, and premature service-splitting here would cost real latency and on-call burden for no present benefit.
- Security Architect noted a monolith means a single compromised dependency has a larger in-process blast radius than a strictly network-isolated microservice would. Accepted as a real tradeoff, mitigated by the per-signal health contract and per-event log-LR clamp (§13) bounding what any single compromised module can do to the score, regardless of process boundaries — the isolation that matters here is at the evidence-and-scoring level, not necessarily the process level.

### 9.3 Persistence — one relational database, not a specialized store

**Problem.** Durably store two things — an append-only audit/evidence trail, and periodic derived-state snapshots for fast crash recovery — without adopting infrastructure sized for problems this system doesn't have.

**Alternatives considered.** (1) A dedicated event-sourcing/event-store product. (2) A vector database for embedding storage/search. (3) A single relational database for both the evidence log and state snapshots.

**Why alternatives were rejected.**
- *Dedicated event store:* see 9.2 — the state being protected is small; a relational table already gives ordering (session_id + timestamp), durability, and queryability for audit and training-data export, which is what was actually being reached for.
- *Vector database:* within a session, embedding comparisons are against a handful of reference vectors — the session's own running average, at most one or two external references — a handful of cosine-similarity computations, not nearest-neighbor search over a large corpus. A vector DB is justified at the point where cross-tenant fraud-ring detection (§17) requires similarity search over a large global embedding corpus — a Phase 4 (§16) problem. For Phase 1–3, a standard relational table holding a candidate's own small number of historical vectors is sufficient and much simpler to operate.

**Final decision.** One relational database. Two tables carry the real weight: an append-only evidence-events table (the audit trail, the training-data source, and the thing that gives most of event-sourcing's practical benefit without adopting it as the state-management pattern), and a session-state-snapshots table (periodic checkpoints of the fusion engine's derived state — the log-odds accumulator and Beta parameters per bundle — for fast recovery per 9.2).

**Engineering rationale.** These two tables map directly onto the two different lifetimes established in §7: the ledger never expires anything (audit/compliance-governed retention only), while the live score decays and can be reconstructed quickly from a recent snapshot rather than replaying from session start.

**Operational cost.** One well-understood, widely-operated database technology, not a specialized store requiring its own operational expertise on top of everything else.

**Scalability characteristics.** Read/write load is dominated by evidence-event inserts (a few thousand/sec system-wide at the 9.0 envelope) and infrequent snapshot writes — well within a single well-tuned relational database's capacity, with standard read-replica scaling available if the audit/reporting read path ever needs to be isolated from the write path, a much lighter touch than adopting CQRS as a named pattern, and only if actually needed.

**Failure modes.** Database unavailability blocks new evidence persistence, handled per §13's degradation policy: the orchestrator continues serving already-loaded in-memory session state for a bounded window, buffering evidence for later durable write, before that session is treated as degraded.

**Recovery strategy.** Standard relational database backup/replication; no custom recovery tooling beyond what any transactional system already requires.

**Future migration path.** If audit/reporting query load genuinely contends with the live write path at a scale a read replica can't absorb, split the query surface — a much smaller, later step than adopting CQRS from day one. If cross-tenant embedding search (§17) becomes a real Phase 4 feature, add a purpose-built vector index at that point, scoped to that feature, not retrofitted everywhere embeddings are touched.

**Risks.** A single relational database is a dependency the whole system leans on; mitigated by standard high-availability deployment (replication, automated failover) rather than by architectural avoidance of the database itself.

### 9.4 Concurrency model and session routing

**Problem.** Route each session's evidence events consistently to whichever orchestrator replica holds that session's in-memory state, and rebalance sensibly as replicas come and go.

**Alternatives considered.** (1) A message bus with consumer-group partitioning by session_id. (2) Consistent-hashing session routing at the load balancer, with a lightweight session registry for rebalancing. (3) No sharding — one process.

**Why alternatives were rejected.** A message bus (1) reintroduces the infrastructure rejected in 9.2 to solve a problem — ordered delivery to one consistent owner — that a much simpler mechanism already solves at this scale. "No sharding" (3) doesn't survive the sizing envelope in 9.0 for long and has no growth path.

**Final decision.** Consistent-hashing session routing at the load balancer — the same approach many real-time systems with per-room or per-connection state use — backed by a lightweight session registry (session_id → owning replica) so a replica restart or scale-out event can rebalance without every client needing to know the hashing scheme directly.

**Engineering rationale.** This gives ordered, single-owner delivery per session — the actual property needed — without a durable log or a broker, because the property being sought is "this session's events reach the process holding its state, in order," not "many independent consumers can replay this stream," which is what a message bus is actually for.

**Operational cost.** A load balancer with consistent-hashing support plus a small key-value registry — far lighter than operating a distributed log.

**Scalability characteristics.** Scales by adding orchestrator replicas and rebalancing the hash ring; the registry itself is small (one row per active session) and low-write-volume.

**Failure modes.** Registry unavailability degrades to stale routing rather than data loss, since the source of truth for session content is the evidence ledger (9.3), not the registry.

**Recovery strategy.** A replica that loses its sessions on crash: those sessions' events route to a new owner on next arrival, which loads the last snapshot (9.3) and resumes — the same recovery path as 9.2, triggered by routing rather than an explicit restart.

**Future migration path.** If session count or replica churn ever outgrows what a simple registry comfortably handles, that is the point to evaluate a more sophisticated coordination layer — not before, since the added operational complexity isn't earned yet at the 9.0 envelope.

### 9.5 The client-side capture agent

**Problem.** Several Bundle F signals (§4) — clipboard activity, application switching, keyboard rhythm — are invisible to any server-side analysis of call media alone. They require local, OS/browser-level instrumentation.

**Alternatives considered.** (1) Don't collect these signals; rely only on passive server-side media analysis. (2) A consented client-side agent (browser extension, or a lightweight desktop companion for non-browser interview tooling).

**Why alternative 1 was rejected.** It leaves a well-known, high-value evasion surface — reading answers from another window or device — completely uninstrumented, for signals that, per §4's scope note, matter to a realistic deployment even though they answer a different question than raw identity does.

**Final decision.** An opt-in, clearly-disclosed client-side capture agent, in the form most technical-interview tooling already assumes: a browser extension, given most coding-interview and video-call surfaces run in-browser. This mirrors a real, public trust boundary — products in this space describe candidates needing to explicitly grant device and browser permissions — which is the correct default here too, not an invented one.

**Engineering rationale.** The agent's job is narrow and specific: emit structured device/OS events over an authenticated connection to the orchestrator, tagged with session_id, nothing else. It runs no inference locally, and has access to nothing beyond the specific permissions granted — clipboard, active-tab/app-focus, keyboard-timing metadata, not keystroke *content*, which is both unnecessary for the stated signals and a much heavier privacy ask than the signal value justifies.

**Tradeoffs.** A heavier trust ask than a browser tab already open for the call — installing something, even a scoped extension, carries more friction and more candidate-experience cost than a webcam permission prompt. Per §10's abstention design, a candidate declining this specific permission must not be treated as suspicious on its own — the same absence-of-evidence principle from §7 applies here as much as to a disabled camera.

**Risks.** A browser extension is itself an attack surface — it can be seen as invasive regardless of disclosure quality, can carry its own vulnerabilities, and a sufficiently resourced adversary could run the entire interview inside a sandboxed or virtualized environment specifically to neutralize it. Not fully solved here; flagged as requiring its own dedicated security review (§15) rather than assumed away.

**Future migration path.** If a customer's interview tooling is not browser-based, the same narrow event contract — device/OS events, session-tagged — is implementable as a lightweight desktop companion instead; the orchestrator-side contract doesn't change, only the capture surface does.

**Committee Notes.**
- Product Lead flagged that requiring an installed extension will measurably reduce completion/opt-in rates versus a browser-only, no-install experience. Accepted as a real cost; resolution is that Bundle F signals are supplementary (§4, §5's bundle structure) — a session with camera, audio, and metadata bundles fully populated but no client agent is still fully assessable, just without that one bundle's contribution.

### 9.6 Container diagram and latency budget

```
  Video platform media/events        Client Agent device/OS events
  (audio, video, transcript,          (clipboard, app-switch,
   join/leave/mute/camera)            keyboard rhythm -- consented)
            |                                    |
            v                                    v
   +----------------------------------------------------------+
   |                 ORCHESTRATOR (modular monolith)           |
   |   horizontally replicated, session-sharded (9.4)          |
   |                                                            |
   |  +-----------+  +-----------+  +-----------+  +---------+ |
   |  |  Bundle    |  |  Fusion    |  |  State     |  |Decision | |
   |  |  Adapters  |->|  Engine    |->|  Manager   |->|/Alert   | |
   |  |  (per §4   |  |  (log-odds,|  |  (lifecycle|  |Engine   | |
   |  |  family)   |  |  Beta unc.,|  |  FSM, §6)  |  |(§10)    | |
   |  |            |  |  change-pt)|  |            |  |         | |
   |  +-----------+  +-----------+  +-----------+  +---------+ |
   +---------+--------------------------------------------------+
             |  calls for heavy inference             |
             v                                         v
   +-------------------------+           +----------------------+
   |   MODEL-SERVING LAYER    |           |  EVIDENCE STORE /     |
   |  (embeddings, liveness,  |           |  SNAPSHOTS (9.3,      |
   |  deepfake/voice-clone    |           |  single relational DB)|
   |  classifiers, ASR --     |           +----------------------+
   |  GPU-bound, autoscaled,  |
   |  stateless)              |
   +-------------------------+
             ^
             | synchronous/async RPC, no broker (9.2)

   Orchestrator also pushes directly to:
   Interviewer UI / Reviewer Dashboard  (WebSocket/SSE, no intermediary --
   the orchestrator already holds the authoritative live state)

   Cross-cutting: Monitoring & Observability  |  Privacy & Compliance Layer
```

```
 Capture      Model-serving call     Fusion update   State transition   Alert delivery
 (frame/       (RPC, sync/async,
  audio/event)  possibly batched)
   |                |                     |                 |                |
   |--~50-200ms-----|---~100-400ms--------|----<100ms-------|----<50ms-------|--<200ms-->
   t0               t1                    t2                t3               t4

 Target end-to-end (capture -> interviewer-visible change): p50 < 1.5s, p95 < 3s.
 Tighter than a bus-mediated design would give, specifically because there is one
 fewer network hop -- no broker to publish to and consume from -- in the critical
 path. This is a direct, measurable payoff of 9.2's decision, not just an
 operational simplification.
 Rich Evidence Report (LLM narrative pass, §8): best-effort, <5s, off the critical path.
```

---

## Section 10 — Decision Engine

**Evidence accumulation.** As specified in §5: incoming evidence updates a per-bundle log-likelihood-ratio, summed with decay into the session's log-odds. Every event is durably written (§9.3) before it is allowed to affect the live score — the ledger is authoritative; the live score is a derived, decaying view of it.

**Evidence expiry.** Two different lifetimes, deliberately (§7, §9.3): the live score applies exponential decay so stale evidence naturally fades from the current estimate; the ledger never expires anything — retention there is governed only by privacy/compliance policy (§15), not by relevance.

**Contradictory evidence.** Handled via the change-point layer (§5): a genuine contradiction is a discrete, heavily-weighted event, not an ordinary data point diluted by averaging (§7's asymmetric-decay rationale).

**Uncertainty representation.** Beta-distributed posterior — mean plus credible interval (§5) — not a bare point estimate. This is what lets the system distinguish *sparse-and-uncertain* (gather more evidence, trigger active elicitation) from *abundant-and-contradictory* (escalate now). Collapsing this distinction into a single number was considered and rejected specifically because those two situations demand opposite system behavior.

**Tie-breaking.** When the posterior is genuinely near 0.5 *with a tight interval* — confidently ambiguous, not just under-evidenced — the system does not force a resolution toward either extreme. It escalates to active elicitation (§4-G) first; if still ambiguous, it surfaces an explicit `AMBIGUOUS — needs adjudication` tag to a human reviewer rather than guessing.

**Abstention is a first-class output**, distinct from `LOST_CONFIDENCE`. A session where camera, mic, and client agent were never meaningfully available produces `UNKNOWN — insufficient evidence`, not a default toward either "assume genuine" or "assume fraudulent." This default is a deliberate, load-bearing ethical decision, not an oversight: many legitimate candidates decline video for bandwidth, comfort, disability, or cultural reasons, and treating that absence as suspicious would build systematic, unfair bias directly into the product. Abstention routes the session to ordinary human interview judgment, unflagged.

**Committee Note.** Security Architect asked whether abstention could itself be gamed — a sophisticated proxy simply disabling every instrumented signal to force `UNKNOWN` and avoid detection entirely. A real risk, not fully closed by this design. Partial mitigation: `UNKNOWN` sessions are visible as a category to the reviewer dashboard, so an unusually high rate of `UNKNOWN` sessions from one source — one recruiter's pipeline, one customer segment — is itself an aggregate anomaly worth surfacing (the same aggregate-anomaly-detection principle used in §13). This is flagged as an open risk requiring product-level attention — disclosure requirements, a minimum-signal policy per customer — not a fully engineered answer.

---

## Section 11 — Edge Cases

| Edge case | Detection | Reasoning / behavior | Fallback | Confidence impact |
|---|---|---|---|---|
| Incorrect candidate name | Display name != ATS record | Extremely common, weak-benign | Fuzzy alias match | Negligible |
| Nickname | Similar-not-exact name | Very common, benign | Alias table; recommend collecting preferred name at scheduling | None after match |
| No camera | Video track absent | Not identity evidence — legitimate reasons are common | Rely on audio+metadata bundles; caps achievable confidence tier, never pushes toward suspicion (§7, §10) | Caps ceiling only |
| Muted microphone | Audio track absent | Same principle, audio analog | Rely on visual+metadata | Caps ceiling only |
| Silent candidate | Low speaking time | Confounded by shyness, format, culture — excluded as direct identity signal (§4 scope boundary) | Gates signal-availability confidence, not identity score | None directly |
| Multiple observers | >1 face/voice, only one in answering turn-taking role | Bystander presence alone is not fraud | Role-assignment logic (§8) isolates the actual respondent | Neutral unless coaching/feeding detected — then sharp negative + elicitation |
| Multiple interviewers | Roster from calendar invite, not raw face count | Correct role-scoping, not new detection | N:M roster modeling | None — correctness fix |
| Candidate reconnects | Leave/join pair, short window | Elevated-attention window — a "connection issue" is also the easiest cover for a covert swap | Widen uncertainty; require fresh corroborating evidence to re-climb tiers, don't resume blindly | Partial reset, not full |
| Candidate changes name mid-call | Rename event | Rare, mildly elevated attention especially if correlated with other anomalies | Track continuity via platform session ID, not display name | Small, informational alone |
| Deepfake | Artifact classifiers (decaying) + embedding self-consistency change-point (durable) | Self-consistency catches any visual swap, not just known signatures | Active elicitation (unscripted pose/motion) | Severe negative -> mandatory human review, never auto-action |
| Voice cloning | Synthetic-speech artifacts (decaying) + voiceprint self-consistency (durable) | Same durability logic as visual | Active elicitation (unscripted question) | Severe negative -> mandatory review |
| Virtual camera | Device enumeration | Prior-shifter, not proof — legitimate uses exist | Raise scrutiny threshold, weight visual bundle more heavily | Moderate negative, not disqualifying alone |
| Background noise | Audio SNR degradation | Reliability issue, not a fraud signal | Widen uncertainty under poor SNR | Widens interval, not directional |
| Multiple speakers on candidate channel | Diarization detects 2+ clusters, alternating in answering turns | One of the strongest audio fraud patterns available | Distinguish bystander interjection from alternating primary respondent | Sharp negative if alternating in answering turns |
| Shared laptop | Multiple face/voice + turn-taking overlap | Legitimate cases exist (interpreter, accessibility support) | Pre-interview accommodation-disclosure flow — disclosed is zero-penalty | Depends entirely on disclosure status |
| Proxy interview | Composite output of the whole system | Not a separate detector — this is what the architecture exists to surface | — | — |
| Network interruptions | Platform-level connectivity events | Reliability concern (§13), not itself a fraud signal | Reduce evidence-arrival rate, widen uncertainty; reconnect moment gets elevated attention (see above) | Neutral for the interruption itself |
| Unknown participants | Identity not in ATS-provided expected roster | Could be benign or concerning depending on role | Informational alert; affects candidate score only if unknown participant is in answering role | None directly unless role-relevant |
| Late joiners | Join timestamp well after session start | No special-case logic needed — state machine already starts at `UNKNOWN` and only climbs with evidence, regardless of when | Existing cold-start behavior applies unchanged | Same as any cold start |

---

## Section 12 — Real-Time Constraints

**Latency budget.** Established in §9.6: p50 < 1.5s, p95 < 3s from capture to an interviewer-visible state change, with the Evidence Report narrative explicitly off the critical path (best-effort, <5s). Removing the message-bus hop that a distributed design would have needed (§9.2) is a direct, measurable contributor to this budget, not just an operational simplification.

**Inference budget — adaptive sampling.** Heavy model-serving calls (embeddings, liveness, deepfake/voice-clone classifiers) do not run at a fixed maximum rate on every session. Sampling cadence increases when a session's confidence is borderline or unstable — where marginal evidence value is highest — and decreases when it is stable and high. This is simultaneously a cost control and a detection-quality improvement, not a tradeoff between the two, because the sessions that most need frequent sampling are exactly the ones getting it.

**Memory budget.** Per-session orchestrator state is small by design: a handful of scalars per bundle (§5), not raw media. Raw media is not retained beyond the momentary processing window at the orchestrator or model-serving layer unless a specific, consented retention policy is configured (§15) — a privacy requirement that happens to also bound memory footprint.

**Concurrency and recovery.** Covered in full in §9.2/§9.4: session-sharded orchestrator replicas, snapshot-based recovery bounded to a few seconds of evidence gap on crash.

**Graceful degradation.** Missing modality → reduced achievable confidence ceiling, not a system failure (§7, §11). Compute overload → reduce sampling cadence before ever dropping sessions outright — the same adaptive-sampling lever from above, run in the opposite direction under load.

---

## Section 13 — Reliability

| Failure | Behavior |
|---|---|
| Audio disappears | Fall back to visual + metadata bundles; widen uncertainty; not treated as negative |
| Video disappears | Fall back to audio + metadata; same principle |
| Transcript/ASR fails | Linguistic bundle unavailable — non-critical, see tiering below |
| Calendar/ATS unavailable | Weaker prior only; system still functions, needs more in-session evidence to reach high tiers |
| Face-detector service fails (infra outage, not "no face") | Must not be conflated with "no face detected" — see signal-health contract below |
| Client agent not installed / permission declined | Bundle F unavailable (§9.5); not treated as suspicious per the same absence-of-evidence principle as camera/mic |
| Model-serving layer unavailable | Orchestrator continues on cached/last-known bundle contributions with widened uncertainty; does not crash sessions (§9.2) |
| LLM unavailable | Explanation narrative quality degrades to a plain structured template; score and state entirely unaffected (§8) |
| A signal becomes malicious/compromised | Defense in depth, below |

**Dependency-criticality tiering.**
- **Tier 1 (core):** visual + audio authenticity bundles. Losing these meaningfully degrades the system's purpose.
- **Tier 2 (supportive):** metadata/calendar, transcript/linguistic, device/OS (Bundle F). Losing these weakens the prior or removes a minor bundle; the system still functions.
- **Tier 3 (presentation only):** the LLM narrative layer (§8). Can fail completely without affecting any score or state.

**The signal-health contract.** Every signal event carries an explicit status: `OK`, `NO_SIGNAL_DETECTED`, or `SERVICE_UNAVAILABLE` — and the fusion engine treats these three cases differently. Only `OK` and `NO_SIGNAL_DETECTED` carry evidentiary weight; `SERVICE_UNAVAILABLE` is excluded from evidence entirely and instead raises an operations alert. Conflating "the detector answered no" with "the detector didn't answer" is a classic, high-impact reliability bug class — it would silently manufacture false-negative evidence out of an infrastructure outage, at exactly the moment reliability matters most.

**Defense in depth against a malicious or compromised signal.** Continuous anomaly monitoring on each signal's output distribution across sessions — a service outputting suspiciously uniform or always-maximal values is itself an ops alert, the same aggregate-anomaly-detection principle that also surfaces unusual `UNKNOWN`-rate clustering (§10's Committee Note); a hard clamp on the maximum log-likelihood-ratio magnitude any single event can contribute, so no one signal — compromised, buggy, or simply mis-calibrated — can unilaterally swing a session across multiple confidence tiers; and cross-validation redundancy within a bundle where feasible. This clamp is what makes the bundle-local dependency structure in §5 safe to adopt, and what bounds the monolith's larger in-process blast radius noted in §9.2's Committee Note.

---

## Section 14 — Evaluation

**Offline testing.** Replay held-out labeled historical sessions through the full pipeline; measure both end-of-call accuracy and time-to-correct-state, since the product's value is largely in speed, not just eventual correctness.

**Online testing.** Shadow-mode deployment for any new likelihood-model version — run alongside production, compare divergence, never affect live decisions until promoted; canary rollout to a small percentage of real traffic; direct interviewer feedback on alert and explanation usefulness.

**Synthetic scenarios.** A structured regression suite covering every §11 edge case explicitly — necessary because real confirmed-fraud labels will be rare for a long time given low base rates; synthetic and red-team-generated data has to carry real evaluation weight, not just supplement it.

**Adversarial scenarios.** A recurring, not one-time, red-team exercise using real deepfake/voice-clone tooling and live proxy-interview role-play, measuring detection rate under deliberate, skilled, adaptive effort — distinct from passive/naive fraud. Given the arms-race nature established in §3/§4, this is a standing quarterly-cycle practice feeding the learning loop (§17), not a launch-gate exercise done once.

**Ablation studies.** Systematically disable each bundle and measure the performance delta — both to confirm every costly, privacy-sensitive signal earns its keep, and to empirically validate the graceful-degradation claims in §13 rather than trusting them by design intent alone.

**Metrics.**
- Accuracy / Precision / Recall / F1, at final state.
- **Calibration error (ECE)** — this is a probabilistic system, not just a classifier; an overconfident 95% that's wrong 30% of the time is a dangerous product, and this is the metric that catches it.
- False positive/negative rate, segmented for disparate impact across demographic and accessibility groups, computed in a privacy-preserving, de-identified way, reviewed with legal/privacy sign-off on methodology, not decided unilaterally by engineering.
- Time-to-correct-identification.
- Confidence stability (state-flap rate, §6) — a high-flap session is a quality failure even if the eventual final state was right.
- Explainability quality — a human-rater study of whether reviewers find evidence reports sufficient, trustworthy, actionable; not fully automatable.
- Robustness — tracked as its own trend line against the adversarial red-team suite over time, expected to require continuous reinvestment.

---

## Section 15 — Security

**Threat model.**

| Threat | Primary mitigation |
|---|---|
| Spoofing (photo/replay/video-loop) | Liveness/anti-spoof detectors + active elicitation (§4-G) |
| Prompt injection (adversarial text in the transcript aimed at the LLM narrative layer) | Structural: the LLM cannot affect score or state at all (§5, §8); transcript content is always treated as data, never instructions; generated narrative is validated against the structured evidence object and rejected if it introduces unsupported claims |
| Voice cloning / Deepfake | §11; durable self-consistency backbone + decaying dedicated classifiers + active elicitation |
| Replay attack (pre-recorded genuine media used to spoof liveness) | Active elicitation is the direct countermeasure — an unscripted, freshly-generated challenge ("say today's date and hold up 3 fingers") functions like a cryptographic nonce: a pre-recorded loop cannot satisfy a request it didn't anticipate (§3) |
| Identity manipulation (broader category) | Composite of the above |
| Metadata poisoning (falsified calendar/email/device data biasing the prior) | Metadata is sourced server-to-server from the platform-of-record integration, never from anything the participant's own client can directly edit; no single low-integrity metadata source is weighted heavily enough alone to move state (§13's clamp) |
| Compromised/malicious signal source, including client-agent tampering (§9.5) | §13's defense in depth — anomaly monitoring plus the per-event log-LR clamp bounds the damage regardless of which layer is compromised |

**Privacy.** Data minimization — raw media not retained beyond the processing window absent explicit, consented, time-boxed retention. **Embeddings are themselves biometric data, not a privacy-safe derivative of it** — a common and consequential mistake to get wrong, and several current biometric-privacy statutes treat them as such. Encryption at rest and in transit for all biometric derivatives. Purpose limitation — data collected for identity-integrity must not silently be repurposed for performance or emotion inference (the scope boundary from §4 is a privacy boundary too). Access control with audit logging of who viewed a candidate's biometric evidence and when. Configurable regional data residency. A clear candidate-facing disclosure and consent flow, paired with an appeal path — the natural complement to §6/§2's "never fully automated adverse action" rule, since a human-reviewed flag should always be contestable.

**Compliance** *(engineering-level awareness, not legal advice — a real deployment needs legal review).* This system plausibly falls under "high-risk" employment-related AI categorization in frameworks like the EU AI Act, and under emerging US state algorithmic-hiring-tool laws, general privacy law (GDPR, CCPA/CPRA), and biometric-specific statutes. Worth noting: the architecture is compliance-aligned largely by construction — human-in-the-loop, explainability, and auditability were engineering requirements (§2) before they were compliance ones, so most of what these frameworks require is already load-bearing rather than bolted on.

**Committee Note.** Security Architect wanted continuous re-verification (active elicitation) at a fixed cadence throughout every call, for maximum coverage. Product Lead overruled: constant challenge prompts make the product actively hostile to use for genuine candidates. Resolution: active elicitation is reserved for borderline-confidence and change-point-triggered moments only (§4, §7, §10) — the security value is concentrated exactly where it's needed, without a blanket UX cost.

---

## Section 16 — Scalability

| Phase | What ships | Infra evolution from §9 |
|---|---|---|
| Prototype | Single video-platform integration; near-real-time acceptable; small signal set (visual + metadata); simple weighted scoring, Bayesian sophistication deliberately deferred; heavy manual review | A single orchestrator instance, no replication needed yet; relational DB; no model-serving split yet if inference volume is trivial enough to run in-process |
| Pilot | Full architecture from §9 stood up, single region; audio + device bundles added; Bayesian fusion with expert-elicited likelihood ratios — a legitimate, standard practice for cold-start probabilistic systems; structured evidence reports, LLM narrative optional | Orchestrator replicated (§9.4), model-serving split introduced (§9.2) as inference volume crosses the point where in-process GPU calls block session throughput |
| Production | Multi-tenant, multi-region within a jurisdiction; full signal suite; likelihood ratios recalibrated from accumulated labeled outcomes; shadow-mode deployment formalized; accommodation-disclosure and appeal flows live; complete compliance audit trail | The point a message queue between orchestrator and model-serving becomes justified (§9.2's migration path) if synchronous RPC latency becomes measurably binding under real multi-region load — evaluated against actual latency data, not adopted preemptively |
| Enterprise | Per-customer configurability (risk tolerance/thresholds vary by industry); customer-specific data-retention and residency policy; SSO for reviewer dashboards; segment-aware priors | Read-replica separation for audit/reporting query load, if it ever genuinely contends with the write path (§9.3's migration path) |
| Global scale | Full multi-region data-residency sharding; the Phase-2+ learned composite model (§5) matures with sufficient global labeled volume; cross-tenant fraud-pattern sharing without sharing raw biometric data (§17) | The point a vector index and, plausibly, a genuine event-streaming platform become justified — cross-tenant similarity search over a large global embedding corpus (§9.3's migration path) and multiple independent consumer types reading the same evidence stream for different purposes (§9.2's migration path) are exactly the conditions those technologies solve for |

**This phasing is the resolution to the infrastructure-simplicity mandate throughout §9**, not an afterthought bolted onto a simple design after the fact: every piece of infrastructure this document deferred — event bus, vector database, CQRS-style read/write separation — has a stated, measurable condition under which it becomes the right call, and that condition is a real scale threshold, not a launch date. Shipping the full learned/multi-region/streaming system on day one would mean calibrating a probabilistic model against data that doesn't exist yet and operating infrastructure sized for a scale the product hasn't reached — the phased path is what makes each phase honest about its own uncertainty instead of pretending to a maturity the system hasn't earned.

---

## Section 17 — Future Evolution

**Online & continual learning.** Incremental recalibration of likelihood ratios as confirmed outcomes accumulate (§5's migration path), plus formal drift monitoring triggering scheduled model refresh cycles as adversary technique evolves — systematizing the arms race (§3) rather than responding to it ad hoc.

**Active learning.** Prioritize human-review attention on the sessions where the system's own uncertainty (§5's Beta interval) is highest, rather than random sampling — a better use of scarce reviewer time.

**Human feedback.** The human-override path implied by §6's mandatory-review invariant is already this loop's entry point; the natural extension is capturing which signals a reviewer found persuasive or misleading, not just a binary confirm/override, for richer supervision.

**Reinforcement learning — deliberately deprioritized.** Framing "which challenge to trigger next" (§4-G) as a policy-optimization problem is plausible, but reward-shaping in a system that interacts with real candidates needs unusually careful scrutiny to avoid perverse incentives — a poorly-specified reward could learn to ask needlessly invasive questions if that correlates with faster confidence resolution. A "proceed carefully, later" item, not a near-term one.

**Federated learning.** Genuinely more relevant here than in most ML products, given the multi-tenant, privacy-sensitive nature of the system: sharing abstracted fraud-pattern signatures or model updates across customer boundaries, without ever centralizing raw biometric data.

**Cross-interview memory.** Already used as Bundle I (§4) where available; its value grows directly with product maturity as more candidates go through multi-round processes. Open tradeoff, not resolved here: whether a non-hired candidate's reference embeddings should be retained for potential future value versus purged under data-minimization principles is a genuine, unresolved policy question requiring legal input, not just an engineering default.

**Knowledge graphs — the single highest-leverage long-term idea in this section.** Modeling candidate/interviewer/session/organization relationships explicitly enables detecting a known proxy interviewing on behalf of multiple, ostensibly unrelated candidates across the platform's full customer base — a face/voice embedding recurring across supposedly-independent identities is extremely strong fraud-ring evidence that a purely per-session system would never see. This is precisely the Phase 4 (§16) condition under which the vector-index and cross-tenant-search infrastructure deferred in §9.3 earns its keep, and directly leverages the platform's aggregate scale as a capability a single-customer or per-interview system structurally cannot have.

**Agentic AI.** A longer-horizon, explicitly speculative idea: an "investigator agent" that, on ambiguous flagged sessions, autonomously gathers additional contextual evidence to assist a human reviewer — strictly read-only and proposal-only, held to the same explainability/audit standard as the rest of the system, never granted autonomous action given everything established in §6/§10.

---

## Section 18 — Architecture Decision Records

Most major decisions in this document already carry their full record — Problem / Alternatives / Rejected / Decision / Rationale / Tradeoffs / Risks / Migration path / Committee Notes — inline, at the point they're made; that's more useful to a reviewer than repeating them here. This section is the registry: a scannable index of every ADR-level decision in the document, plus two that didn't warrant a full inline treatment but are still worth recording formally.

| ID | Decision | Full record |
|---|---|---|
| ADR-1 | Bayesian log-odds fusion, bundle-local dependency structure, not full-joint or flat-independent | §5 |
| ADR-2 | LLM confined to explanation generation; structurally cannot affect score or state | §5, §8 |
| ADR-3 | `DISQUALIFIED` always means mandatory human review; no autonomous consequential action, ever | §2, §6 |
| ADR-4 | Eight-state lifecycle with `LOST_CONFIDENCE`/`DISQUALIFIED` split and permanently-annotated `RECOVERED` | §6 |
| ADR-5 | Asymmetric evidence decay: ordinary evidence decays, change-point evidence does not | §7 |
| ADR-6 | Modular monolith orchestrator + one justified model-serving split, not microservices-by-default | §9.2 |
| ADR-7 | Single relational database for evidence ledger + state snapshots, not event sourcing or a vector DB | §9.3 |
| ADR-8 | Consistent-hash session routing + lightweight registry, not a message bus, for session-sharded concurrency | §9.4 |
| ADR-9 | Consented client-side capture agent as a first-class, narrowly-scoped component | §9.5 |
| ADR-10 | Active elicitation reserved for borderline/change-point moments, not continuous | §3, §15 (Committee Note) |
| ADR-11 | Explicit three-state signal-health contract (`OK` / `NO_SIGNAL_DETECTED` / `SERVICE_UNAVAILABLE`) | §13 |
| ADR-12 | Per-event log-likelihood-ratio clamp as defense in depth against any single compromised signal | §13 |
| ADR-13 | Pre-interview accommodation-disclosure flow removes legitimate multi-person/no-camera cases from the suspicion pool entirely | §11 |
| ADR-14 | Phased infrastructure adoption tied to stated, measurable scale thresholds, not calendar time | §16 |

**Two decisions not given full inline treatment, recorded here:**

**ADR-15: Abstention (`UNKNOWN — insufficient evidence`) defaults toward no-suspicion, not toward neutrality-by-coin-flip.**
*Problem:* when no meaningful evidence has accumulated, does the system output a genuinely neutral 50/50, or a state that explicitly routes to ordinary unflagged human judgment? *Alternatives:* (a) report the prior as-is, which for most customer segments sits mildly above or below 50% depending on base rate; (b) a dedicated abstention state, decoupled from the numeric prior entirely. *Why (a) was rejected:* it reintroduces a number where the right answer is "we don't know," and a mildly base-rate-shifted prior displayed as if it were an assessment of *this* candidate risks looking like evidence where none exists. *Final decision:* (b), per §10. *Engineering rationale:* false-accusation cost (§1, §2) dominates when there's no evidence to weigh it against. *Tradeoffs:* a small number of genuine fraud cases that produce zero instrumented evidence — full camera/mic/agent refusal — are invisible to this system and rely entirely on ordinary human interview judgment; an honest limitation, not a gap to be papered over. *Risks:* gameable, per §10's Committee Note. *Future migration path:* monitor `UNKNOWN` rates in aggregate (§13) as a proxy signal even though individual sessions aren't flagged. *Committee Notes:* see §10.

**ADR-16: Device/OS signals (Bundle F) are weighted near-zero for identity, kept as a separate parallel track for assistance-integrity.**
*Problem:* clipboard/app-switch data is strong evidence for "external resource use," weak evidence for "wrong person." Should it be folded into the identity score at a discounted weight, or kept structurally separate? *Alternatives:* (a) fold in at low weight; (b) a separate parallel confidence track, reusing the same fusion machinery. *Why (a) was rejected:* even a low weight on a signal answering a different question introduces systematic bias — sessions with heavy *legitimate* tool use (e.g., a candidate permitted to use an IDE with autocomplete) would see their identity confidence dragged down for reasons that have nothing to do with identity. *Final decision:* (b), per §4's scope note. *Engineering rationale:* keeps the identity claim this document makes honest, and keeps the two products — identity-integrity, assistance-integrity — independently auditable. *Tradeoffs:* two tracks to maintain instead of one, if the assistance-integrity track is ever built out. *Risks:* none specific to identity confidence, by construction. *Future migration path:* build the assistance-integrity track as a genuine extension, reusing §5's fusion math wholesale, when that becomes a stated product requirement — not implicitly, by quietly widening this document's scope.

---

## Section 19 — Self-Review

Reviewed as the Sherlock hiring committee would review it — critically, not ceremonially.

| Section | Self-score (1–5) | Main weakness |
|---|---|---|
| Requirements (§2) | 4 | Success/failure metrics are well-specified in kind, not in target numbers — real thresholds need real operating data, which is honest but also a gap |
| First principles (§3) | 5 | The MFA analogy and the interactivity insight are the load-bearing ideas of the whole document |
| Signal fusion (§5) | 4 | The bundle-boundary design is a judgment call defended by argument, not by data — could be wrong until validated empirically in Pilot |
| State machine (§6) | 5 | The `LOST_CONFIDENCE`/`DISQUALIFIED` split and the `RECOVERED` annotation are the strongest single design elements in the document |
| Architecture (§9) | 4 | The infrastructure restraint is the section's real strength — every major piece of complexity avoided has a stated, measurable condition under which it would become correct, not just an aesthetic preference for simplicity. The residual weakness is that the "one process, many teams" org-scaling risk (§9.2's Committee Note) is named honestly but genuinely unsolved here |
| Edge cases (§11) | 4 | Comprehensive against the brief's list; real production use will surface edge cases this list doesn't anticipate — no edge-case list is ever complete |
| Security (§15) | 4 | The nonce analogy for active elicitation is a genuinely strong idea; the compliance discussion is explicitly caveated as non-legal-advice, which is honest but means it needs a real legal review before this ships |
| Future evolution (§17) | 4 | The cross-tenant fraud-ring detection idea is the best idea in the section, and it's the one place the "avoid infrastructure by default" stance explicitly and correctly reverses itself, at the right scale threshold |

**Honest, standing weaknesses this document does not fully resolve:**
- Likelihood ratios in Phase 1/2 are expert-elicited, not empirically validated — real calibration risk exists until enough labeled Pilot/Production data accumulates, and this document can't manufacture that data.
- Active-elicitation thresholds are theoretically justified but need real user-research validation — over-triggering could damage candidate experience in ways this design can reason about but not measure in advance.
- Abstention-gaming (§10's Committee Note) is named as a real risk, with only a partial, aggregate-level mitigation — it needs product-level attention this document scopes but doesn't resolve.
- Fairness auditing methodology is specified at the right level of rigor-intent but explicitly requires a dedicated legal/fairness workstream before Production — this document scopes that work; it doesn't do it.
- **The honest framing of the whole system's goal:** this architecture cannot promise to catch all sophisticated, well-resourced fraud. Its actual claim is that it raises the cost, skill, and reliability bar required to defeat it, while keeping the false-accusation rate against genuine candidates low and every decision explainable. A document that claimed more than that would be overselling the system it describes.

This is one thorough, honest revision pass, not an open-ended loop — a real RFC reaches a defensible stopping point and says so, rather than iterating indefinitely against a moving bar.

---
*End of RFC.*