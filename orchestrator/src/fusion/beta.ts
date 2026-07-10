/**
 * Numerical primitives for the Beta-distributed posterior (RFC §5:
 * "carried as a Beta distribution — mean plus credible interval — not a
 * point estimate"). Self-contained (no dependency beyond the standard
 * library) since this is exactly the kind of "core math... unit-testable
 * in isolation" M3 asks for.
 *
 * Implementation notes: `logGamma` uses the Lanczos approximation (g=7, the
 * widely-used 9-term coefficient set); `regularizedIncompleteBeta` uses the
 * standard continued-fraction evaluation (Lentz's algorithm) for the
 * incomplete beta function, the same approach used by most numerical
 * libraries (e.g. Numerical Recipes' `betai`/`betacf`). `betaQuantile`
 * inverts it by bisection, which is simple, numerically stable, and more
 * than precise enough at double-precision for a credible interval used to
 * distinguish "sparse" from "abundant-and-contradictory" evidence (§10) —
 * not for anything requiring more than a handful of significant digits.
 */

const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** Natural log of the Gamma function, via the Lanczos approximation. */
export function logGamma(x: number): number {
  if (x < 0.5) {
    // Reflection formula: Gamma(x)Gamma(1-x) = pi / sin(pi x).
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }

  const shifted = x - 1;
  let a = LANCZOS_COEFFICIENTS[0] as number;
  const t = shifted + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_G + 2; i++) {
    a += (LANCZOS_COEFFICIENTS[i] as number) / (shifted + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(a);
}

const CONTINUED_FRACTION_MAX_ITERATIONS = 200;
const CONTINUED_FRACTION_EPSILON = 3e-16;
const CONTINUED_FRACTION_FLOOR = 1e-300;

/** Continued-fraction evaluation used by `regularizedIncompleteBeta` (Lentz's algorithm). */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < CONTINUED_FRACTION_FLOOR) d = CONTINUED_FRACTION_FLOOR;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= CONTINUED_FRACTION_MAX_ITERATIONS; m++) {
    const m2 = 2 * m;

    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < CONTINUED_FRACTION_FLOOR) d = CONTINUED_FRACTION_FLOOR;
    c = 1 + aa / c;
    if (Math.abs(c) < CONTINUED_FRACTION_FLOOR) c = CONTINUED_FRACTION_FLOOR;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < CONTINUED_FRACTION_FLOOR) d = CONTINUED_FRACTION_FLOOR;
    c = 1 + aa / c;
    if (Math.abs(c) < CONTINUED_FRACTION_FLOOR) c = CONTINUED_FRACTION_FLOOR;
    d = 1 / d;
    const delta = d * c;
    h *= delta;

    if (Math.abs(delta - 1) < CONTINUED_FRACTION_EPSILON) break;
  }
  return h;
}

function assertPositive(name: string, value: number): void {
  if (!(value > 0)) {
    throw new RangeError(`${name} must be positive, received ${value}`);
  }
}

/**
 * The regularized incomplete beta function `I_x(a, b)` — the CDF of
 * Beta(a, b) evaluated at `x`. Returns a value in `[0, 1]`.
 */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  assertPositive('a', a);
  assertPositive('b', b);
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const logPrefactor =
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const prefactor = Math.exp(logPrefactor);

  if (x < (a + 1) / (a + b + 2)) {
    return (prefactor * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (prefactor * betaContinuedFraction(1 - x, b, a)) / b;
}

const QUANTILE_BISECTION_ITERATIONS = 100;

/**
 * Inverts `regularizedIncompleteBeta` by bisection: the value `x` such that
 * `P(X <= x) = p` for `X ~ Beta(alpha, beta)`.
 */
export function betaQuantile(p: number, alpha: number, beta: number): number {
  assertPositive('alpha', alpha);
  assertPositive('beta', beta);
  if (p < 0 || p > 1) {
    throw new RangeError(`p must be within [0, 1], received ${p}`);
  }
  if (p === 0) return 0;
  if (p === 1) return 1;

  let lower = 0;
  let upper = 1;
  for (let i = 0; i < QUANTILE_BISECTION_ITERATIONS; i++) {
    const mid = (lower + upper) / 2;
    const cdf = regularizedIncompleteBeta(mid, alpha, beta);
    if (cdf < p) {
      lower = mid;
    } else {
      upper = mid;
    }
  }
  return (lower + upper) / 2;
}

export interface BetaCredibleInterval {
  readonly lower: number;
  readonly upper: number;
  readonly mass: number;
}

/**
 * The equal-tailed credible interval capturing `mass` probability (default
 * 90%) of Beta(alpha, beta) — e.g. for `mass = 0.9`, the interval between
 * the 5th and 95th percentiles.
 */
export function betaCredibleInterval(
  alpha: number,
  beta: number,
  mass = 0.9,
): BetaCredibleInterval {
  if (mass <= 0 || mass >= 1) {
    throw new RangeError(`mass must be within (0, 1), received ${mass}`);
  }
  const tail = (1 - mass) / 2;
  return {
    lower: betaQuantile(tail, alpha, beta),
    upper: betaQuantile(1 - tail, alpha, beta),
    mass,
  };
}
