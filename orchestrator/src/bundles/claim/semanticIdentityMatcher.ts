/**
 * Semantic identity-field matching for the Claim bundle (RFC §4-A).
 *
 * Replaces exact string equality with fuzzy, explainable comparisons that
 * tolerate abbreviations, nicknames, typos, and reordered name tokens while
 * still emitting a boolean `matched` flag the Fusion Engine consumes unchanged.
 */

export type IdentityFieldKind = 'display_name' | 'email' | 'calendar_invite';

export interface SemanticIdentityMatchInput {
  readonly observed: string;
  readonly claimed: string;
  readonly aliases?: readonly string[];
  readonly kind: IdentityFieldKind;
}

export interface SemanticIdentityMatchResult {
  readonly similarity: number;
  readonly confidence: number;
  readonly matchedFields: readonly string[];
  readonly matched: boolean;
}

const NAME_MATCH_THRESHOLD = 0.78;
const EMAIL_MATCH_THRESHOLD = 0.82;
const CALENDAR_MATCH_THRESHOLD = 0.85;

/** Canonical short-form → formal given names (Phase-1, hand-curated). */
const NICKNAME_GROUPS: readonly (readonly string[])[] = [
  ['bob', 'bobby', 'rob', 'robert', 'robbie'],
  ['bill', 'will', 'william', 'billy'],
  ['liz', 'lizzy', 'beth', 'betty', 'elizabeth', 'lisa'],
  ['mike', 'mick', 'michael'],
  ['dick', 'rick', 'rich', 'richard'],
  ['jim', 'jimmy', 'james', 'jamie'],
  ['joe', 'joey', 'joseph'],
  ['tom', 'tommy', 'thomas'],
  ['kate', 'katie', 'kathy', 'katherine', 'catherine'],
  ['alex', 'alexander', 'alexandra', 'alexis'],
  ['chris', 'christopher', 'christina', 'christine'],
  ['dan', 'danny', 'daniel'],
  ['matt', 'matthew'],
  ['sam', 'samuel', 'samantha'],
  ['tony', 'anthony'],
  ['pat', 'patrick', 'patricia'],
  ['jen', 'jenny', 'jennifer'],
  ['steve', 'stephen', 'steven'],
  ['nick', 'nicholas', 'nicole'],
  ['ed', 'eddie', 'edward', 'edwin'],
];

const NICKNAME_LOOKUP = buildNicknameLookup();

function buildNicknameLookup(): ReadonlyMap<string, ReadonlySet<string>> {
  const lookup = new Map<string, Set<string>>();
  for (const group of NICKNAME_GROUPS) {
    const normalized = group.map(normalizeToken);
    const set = new Set(normalized);
    for (const token of normalized) {
      lookup.set(token, set);
    }
  }
  return lookup;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeName(value: string): string[] {
  return normalizeToken(value)
    .split(/[\s-]+/)
    .map((token) => token.replace(/\./g, ''))
    .filter((token) => token.length > 0);
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j += 1) {
    previous[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j]!;
    }
  }

  return previous[b.length]!;
}

function levenshteinRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / Math.max(a.length, b.length, 1);
}

function initialsFromTokens(tokens: readonly string[]): string {
  return tokens.map((token) => token[0] ?? '').join('');
}

function isAbbreviationOf(short: string, full: string): boolean {
  const normalizedShort = short.replace(/\./g, '');
  if (normalizedShort.length === 0 || full.length === 0) return false;
  if (normalizedShort.length === 1) {
    return full.startsWith(normalizedShort);
  }
  return full.startsWith(normalizedShort) && normalizedShort.length >= 2;
}

function tokensNicknameMatch(a: string, b: string): boolean {
  const setA = NICKNAME_LOOKUP.get(a);
  const setB = NICKNAME_LOOKUP.get(b);
  if (setA === undefined || setB === undefined) return false;
  for (const token of setA) {
    if (setB.has(token)) return true;
  }
  return false;
}

interface NameCandidate {
  readonly similarity: number;
  readonly confidence: number;
  readonly matchedFields: readonly string[];
}

function bestTokenAlignment(obsTokens: readonly string[], clmTokens: readonly string[]): NameCandidate | null {
  if (obsTokens.length === 0 || clmTokens.length === 0) return null;

  const matchedFields = new Set<string>();
  let matchedCount = 0;
  const usedClaimed = new Set<number>();

  for (const obsToken of obsTokens) {
    let bestIndex = -1;
    let bestScore = 0;
    let bestFields: string[] = [];

    for (let index = 0; index < clmTokens.length; index += 1) {
      if (usedClaimed.has(index)) continue;
      const clmToken = clmTokens[index]!;
      const evaluation = scoreTokenPair(obsToken, clmToken);
      if (evaluation.score > bestScore) {
        bestScore = evaluation.score;
        bestIndex = index;
        bestFields = evaluation.fields;
      }
    }

    if (bestIndex >= 0 && bestScore >= 0.75) {
      matchedCount += 1;
      usedClaimed.add(bestIndex);
      for (const field of bestFields) matchedFields.add(field);
    }
  }

  if (matchedCount === 0) return null;

  const coverage = matchedCount / Math.max(obsTokens.length, clmTokens.length);
  const similarity = Math.min(0.98, 0.7 + coverage * 0.28);
  return {
    similarity,
    confidence: coverage >= 1 ? 0.9 : 0.78,
    matchedFields: ['participant_display_name', 'candidate_name', ...matchedFields],
  };
}

function scoreTokenPair(obsToken: string, clmToken: string): { score: number; fields: string[] } {
  if (obsToken === clmToken) {
    return { score: 1, fields: ['token_exact'] };
  }
  if (tokensNicknameMatch(obsToken, clmToken)) {
    return { score: 0.92, fields: ['nickname'] };
  }
  if (isAbbreviationOf(obsToken, clmToken) || isAbbreviationOf(clmToken, obsToken)) {
    return { score: 0.9, fields: ['abbreviation', 'initials'] };
  }
  const typoScore = levenshteinRatio(obsToken, clmToken);
  if (typoScore >= 0.75) {
    return { score: typoScore, fields: ['typo_tolerant'] };
  }
  return { score: 0, fields: [] };
}

function compareNamePair(observed: string, claimed: string): NameCandidate {
  const obsNorm = normalizeToken(observed);
  const clmNorm = normalizeToken(claimed);

  if (obsNorm === clmNorm) {
    return { similarity: 1, confidence: 1, matchedFields: ['exact', 'candidate_name'] };
  }

  const obsTokens = tokenizeName(observed);
  const clmTokens = tokenizeName(claimed);

  const candidates: NameCandidate[] = [];

  const obsSorted = [...obsTokens].sort().join(' ');
  const clmSorted = [...clmTokens].sort().join(' ');
  if (obsSorted === clmSorted && obsTokens.length > 0) {
    candidates.push({
      similarity: 0.96,
      confidence: 0.92,
      matchedFields: ['reordered_name', 'candidate_name', 'participant_display_name'],
    });
  }

  const alignment = bestTokenAlignment(obsTokens, clmTokens);
  if (alignment !== null) {
    candidates.push(alignment);
  }

  const obsInitials = initialsFromTokens(obsTokens);
  const clmInitials = initialsFromTokens(clmTokens);
  if (
    obsInitials.length >= 2 &&
    clmInitials.length >= 2 &&
    (obsInitials === clmInitials || levenshteinRatio(obsInitials, clmInitials) >= 0.85)
  ) {
    candidates.push({
      similarity: 0.88,
      confidence: 0.8,
      matchedFields: ['initials', 'candidate_name'],
    });
  }

  const compactObs = obsNorm.replace(/\s+/g, '');
  const compactClm = clmNorm.replace(/\s+/g, '');
  const typoRatio = levenshteinRatio(compactObs, compactClm);
  if (typoRatio >= 0.72) {
    candidates.push({
      similarity: typoRatio,
      confidence: typoRatio >= 0.9 ? 0.88 : 0.72,
      matchedFields: ['typo_tolerant', 'candidate_name', 'participant_display_name'],
    });
  }

  const tokenJaccard = jaccardSimilarity(new Set(obsTokens), new Set(clmTokens));
  if (tokenJaccard >= 0.6 && obsSorted !== clmSorted) {
    candidates.push({
      similarity: tokenJaccard,
      confidence: 0.7,
      matchedFields: ['token_overlap', 'candidate_name'],
    });
  }

  if (candidates.length === 0) {
    return { similarity: typoRatio, confidence: 0.5, matchedFields: ['candidate_name'] };
  }

  return candidates.reduce((best, current) =>
    current.similarity > best.similarity ? current : best,
  );
}

function jaccardSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function parseEmail(value: string): { local: string; domain: string } | null {
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return null;
  return {
    local: normalizeToken(value.slice(0, at)),
    domain: normalizeToken(value.slice(at + 1)),
  };
}

function compareEmailPair(observed: string, claimed: string): NameCandidate {
  const obs = parseEmail(observed);
  const clm = parseEmail(claimed);

  if (obs === null || clm === null) {
    const ratio = levenshteinRatio(normalizeToken(observed), normalizeToken(claimed));
    return {
      similarity: ratio,
      confidence: 0.5,
      matchedFields: ['email'],
    };
  }

  if (obs.domain !== clm.domain) {
    return {
      similarity: Math.max(0, levenshteinRatio(obs.domain, clm.domain) * 0.4),
      confidence: 0.9,
      matchedFields: ['email_domain'],
    };
  }

  if (obs.local === clm.local) {
    return {
      similarity: 1,
      confidence: 1,
      matchedFields: ['email', 'email_domain', 'email_local_part'],
    };
  }

  const localRatio = levenshteinRatio(obs.local, clm.local);
  const plusLocal = obs.local.replace(/\+.*$/, '');
  const plusClaimed = clm.local.replace(/\+.*$/, '');
  const strippedRatio = levenshteinRatio(plusLocal, plusClaimed);

  const similarity = Math.max(localRatio, strippedRatio);
  const matchedFields: string[] = ['email', 'email_domain', 'email_local_part'];
  if (strippedRatio > localRatio) {
    matchedFields.push('email_plus_tag_stripped');
  }
  if (similarity < 1) {
    matchedFields.push('typo_tolerant');
  }

  return {
    similarity,
    confidence: similarity >= 0.95 ? 0.95 : 0.78,
    matchedFields,
  };
}

function compareEmailDomains(observed: string, claimed: string): NameCandidate {
  const obs = parseEmail(observed);
  const clm = parseEmail(claimed);
  if (obs === null || clm === null) {
    const obsDomain = observed.includes('@') ? observed.slice(observed.lastIndexOf('@') + 1) : observed;
    const clmDomain = claimed.includes('@') ? claimed.slice(claimed.lastIndexOf('@') + 1) : claimed;
    const matched = normalizeToken(obsDomain) === normalizeToken(clmDomain);
    return {
      similarity: matched ? 1 : levenshteinRatio(normalizeToken(obsDomain), normalizeToken(clmDomain)),
      confidence: matched ? 1 : 0.7,
      matchedFields: matched ? ['email_domain'] : ['email_domain'],
    };
  }

  const matched = obs.domain === clm.domain;
  return {
    similarity: matched ? 1 : levenshteinRatio(obs.domain, clm.domain) * 0.5,
    confidence: matched ? 1 : 0.75,
    matchedFields: ['email', 'email_domain'],
  };
}

function pickBest(candidates: readonly NameCandidate[]): NameCandidate {
  return candidates.reduce((best, current) =>
    current.similarity > best.similarity ? current : best,
  );
}

export function matchIdentityField(input: SemanticIdentityMatchInput): SemanticIdentityMatchResult {
  const observed = normalizeWhitespace(input.observed);
  const claimed = normalizeWhitespace(input.claimed);
  const aliases = input.aliases ?? [];

  const comparisons: NameCandidate[] = [];

  if (input.kind === 'display_name') {
    comparisons.push(compareNamePair(observed, claimed));
    for (const alias of aliases) {
      const aliasResult = compareNamePair(observed, alias);
      comparisons.push({
        ...aliasResult,
        matchedFields: [...aliasResult.matchedFields, 'alias'],
      });
    }
  } else if (input.kind === 'email') {
    comparisons.push(compareEmailDomains(observed, claimed));
  } else {
    comparisons.push(compareEmailPair(observed, claimed));
    for (const alias of aliases) {
      if (alias.includes('@')) {
        const aliasResult = compareEmailPair(observed, alias);
        comparisons.push({
          ...aliasResult,
          matchedFields: [...aliasResult.matchedFields, 'alias'],
        });
      }
    }
  }

  const best = pickBest(comparisons);

  const obsTokens = tokenizeName(observed);
  const clmTokens = tokenizeName(claimed);
  const matchedFields = [...best.matchedFields];
  if (
    obsTokens.length > 0 &&
    [...obsTokens].sort().join(' ') === [...clmTokens].sort().join(' ')
  ) {
    if (!matchedFields.includes('reordered_name')) {
      matchedFields.push('reordered_name');
    }
  }

  const threshold =
    input.kind === 'display_name'
      ? NAME_MATCH_THRESHOLD
      : input.kind === 'email'
        ? EMAIL_MATCH_THRESHOLD
        : CALENDAR_MATCH_THRESHOLD;

  const domainGate =
    input.kind === 'email'
      ? best.matchedFields.includes('email_domain') && best.similarity >= EMAIL_MATCH_THRESHOLD
      : input.kind === 'calendar_invite'
        ? best.matchedFields.includes('email_domain') && best.similarity >= CALENDAR_MATCH_THRESHOLD
        : best.similarity >= threshold;

  return {
    similarity: best.similarity,
    confidence: best.confidence,
    matchedFields,
    matched: domainGate,
  };
}

export function buildSemanticClaimMatchValue(
  observed: string | null,
  claimed: string | null,
  kind: IdentityFieldKind,
  aliases: readonly string[] = [],
): {
  matched: boolean;
  observedValue: string | null;
  claimedValue: string | null;
  similarity: number | null;
  confidence: number | null;
  matchedFields: string[];
} {
  if (observed === null || claimed === null) {
    return {
      matched: false,
      observedValue: observed,
      claimedValue: claimed,
      similarity: null,
      confidence: null,
      matchedFields: [],
    };
  }

  const result = matchIdentityField({ observed, claimed, aliases, kind });
  return {
    matched: result.matched,
    observedValue: observed,
    claimedValue: claimed,
    similarity: result.similarity,
    confidence: result.confidence,
    matchedFields: [...result.matchedFields],
  };
}
