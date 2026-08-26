/**
 * Matchmaker — SPEC.md §9.3.
 *
 * Dealbreaker filters first, then weighted preference scoring, producing a
 * ranked list framed as **"matches your stated criteria"**, with the criteria
 * restated alongside it.
 *
 * ── The three things this must never become ────────────────────────────────
 *  1. **A recommendation.** Ranking is on physical and technical fit only —
 *     never on effectiveness, for any use tag. The site does not know what the
 *     reader wants and pretending otherwise is the editorial failure this
 *     project exists to avoid.
 *  2. **A budget filter.** SPEC.md §9.3 is explicit: we have launch MSRP and
 *     inflation adjustment, not current market value, so a budget question
 *     would be a lie. There is no price input here at all.
 *  3. **A legality filter.** SPEC.md §14 — no jurisdiction data, no "legal for
 *     you". The site states what a firearm *is*, never what a reader *may do*.
 *
 * Every score component below is a distance from something the reader asked
 * for, in the reader's own terms. Nothing is a judgement about the arm.
 *
 * Pure. No DOM, no I/O, no framework import.
 */

/** The seven inputs of SPEC.md §9.3. All optional: nothing is a required taste. */
export interface MatchCriteria {
  /** Role tags the reader is interested in. */
  useTags?: string[];
  /** Cartridge ids, or empty for no preference. */
  cartridgeRefs?: string[];
  /** Dealbreaker: loaded mass at or below this, kg. */
  maxLoadedMassKg?: number;
  /** Dealbreaker: capacity at or above this. */
  minCapacity?: number;
  /** Action tags the reader wants. */
  actions?: string[];
  /** Dealbreaker: free recoil energy at or below this, J. */
  maxFreeRecoilJ?: number;
  /** Era ids the reader is interested in. */
  eras?: string[];
}

/** What the matcher needs to know about one candidate. All already computed. */
export interface Candidate {
  id: string;
  name: string;
  type?: string;
  action?: string;
  roles: string[];
  cartridgeRefs: string[];
  era?: string;
  loadedMassKg: number | null;
  capacity: number | null;
  freeRecoilJ: number | null;
}

export interface MatchReason {
  criterion: string;
  /** 0–1. What fraction of this criterion's weight the candidate earned. */
  satisfaction: number;
  /** Shown next to the result. Plain language, no adjectives about the arm. */
  detail: string;
}

export interface MatchResult {
  candidate: Candidate;
  /** 0–1, the weighted mean of the reasons. Never displayed as a rating. */
  fit: number;
  reasons: MatchReason[];
}

export interface Exclusion {
  candidate: Candidate;
  /** Which dealbreaker removed it, in the reader's own words. */
  because: string;
}

export interface MatchOutcome {
  matches: MatchResult[];
  excluded: Exclusion[];
  /** The criteria as applied, for restating above the results. */
  applied: string[];
}

/** Equal weight per stated criterion: the reader stated them, we do not rank them. */
const WEIGHT = 1;

/**
 * A dealbreaker with a missing figure does NOT exclude the candidate.
 *
 * Excluding on absent data would quietly punish thinly-sourced entries and
 * silently hide arms that might well qualify — presenting a gap as a fact about
 * the arm. They are kept, and the missing figure is what the reason line says.
 */
function passesDealbreakers(candidate: Candidate, criteria: MatchCriteria): string | null {
  if (
    criteria.maxLoadedMassKg !== undefined &&
    candidate.loadedMassKg !== null &&
    candidate.loadedMassKg > criteria.maxLoadedMassKg
  ) {
    return `loaded mass ${candidate.loadedMassKg.toFixed(2)} kg is over your ${criteria.maxLoadedMassKg} kg ceiling`;
  }
  if (
    criteria.minCapacity !== undefined &&
    candidate.capacity !== null &&
    candidate.capacity < criteria.minCapacity
  ) {
    return `capacity ${candidate.capacity} is under your floor of ${criteria.minCapacity}`;
  }
  if (
    criteria.maxFreeRecoilJ !== undefined &&
    candidate.freeRecoilJ !== null &&
    candidate.freeRecoilJ > criteria.maxFreeRecoilJ
  ) {
    return `free recoil ${candidate.freeRecoilJ.toFixed(1)} J is over your ${criteria.maxFreeRecoilJ} J ceiling`;
  }
  if (
    criteria.cartridgeRefs !== undefined &&
    criteria.cartridgeRefs.length > 0 &&
    !candidate.cartridgeRefs.some((ref) => criteria.cartridgeRefs!.includes(ref))
  ) {
    return 'not chambered in any cartridge you named';
  }
  return null;
}

function scoreCandidate(candidate: Candidate, criteria: MatchCriteria): MatchReason[] {
  const reasons: MatchReason[] = [];

  if (criteria.useTags?.length) {
    const shared = candidate.roles.filter((role) => criteria.useTags!.includes(role));
    reasons.push({
      criterion: 'intended use',
      satisfaction: shared.length > 0 ? Math.min(1, shared.length / criteria.useTags.length) : 0,
      detail:
        shared.length > 0
          ? `recorded for ${shared.join(', ')}`
          : 'no recorded role matches what you asked for',
    });
  }

  if (criteria.actions?.length) {
    const matched = candidate.action !== undefined && criteria.actions.includes(candidate.action);
    reasons.push({
      criterion: 'action',
      satisfaction: matched ? 1 : 0,
      detail: candidate.action ? `${candidate.action}` : 'action not recorded',
    });
  }

  if (criteria.eras?.length) {
    const matched = candidate.era !== undefined && criteria.eras.includes(candidate.era);
    reasons.push({
      criterion: 'era',
      satisfaction: matched ? 1 : 0,
      detail: candidate.era ?? 'introduction year not recorded',
    });
  }

  // The three numeric criteria score by headroom, so an arm well inside a
  // ceiling ranks above one that only just clears it. Missing figures score
  // neutral rather than zero: an unrecorded mass is not a heavy arm.
  const headroom = (
    value: number | null,
    limit: number | undefined,
    label: string,
    unit: string,
    lowerIsBetter: boolean,
  ): void => {
    if (limit === undefined) return;
    if (value === null) {
      reasons.push({ criterion: label, satisfaction: 0.5, detail: `${label} not recorded` });
      return;
    }
    const ratio = lowerIsBetter ? 1 - value / limit : value / limit - 1;
    reasons.push({
      criterion: label,
      satisfaction: Math.max(0, Math.min(1, lowerIsBetter ? ratio : Math.min(1, ratio + 0.5))),
      detail: `${value.toFixed(unit === '' ? 0 : 2)}${unit ? ` ${unit}` : ''} against your ${limit}${unit ? ` ${unit}` : ''}`,
    });
  };

  headroom(candidate.loadedMassKg, criteria.maxLoadedMassKg, 'loaded mass', 'kg', true);
  headroom(candidate.freeRecoilJ, criteria.maxFreeRecoilJ, 'free recoil', 'J', true);
  headroom(candidate.capacity, criteria.minCapacity, 'capacity', '', false);

  if (criteria.cartridgeRefs?.length) {
    const shared = candidate.cartridgeRefs.filter((ref) => criteria.cartridgeRefs!.includes(ref));
    reasons.push({
      criterion: 'cartridge',
      satisfaction: shared.length > 0 ? 1 : 0,
      detail: shared.length > 0 ? `chambered in ${shared.join(', ')}` : 'no cartridge you named',
    });
  }

  return reasons;
}

/** The criteria, restated in plain language above the results. */
export function describeCriteria(criteria: MatchCriteria): string[] {
  const applied: string[] = [];
  if (criteria.useTags?.length) applied.push(`intended use: ${criteria.useTags.join(', ')}`);
  if (criteria.cartridgeRefs?.length) applied.push(`cartridge: ${criteria.cartridgeRefs.join(', ')}`);
  if (criteria.maxLoadedMassKg !== undefined) applied.push(`loaded mass at most ${criteria.maxLoadedMassKg} kg`);
  if (criteria.minCapacity !== undefined) applied.push(`capacity at least ${criteria.minCapacity}`);
  if (criteria.actions?.length) applied.push(`action: ${criteria.actions.join(', ')}`);
  if (criteria.maxFreeRecoilJ !== undefined) applied.push(`free recoil at most ${criteria.maxFreeRecoilJ} J`);
  if (criteria.eras?.length) applied.push(`era: ${criteria.eras.join(', ')}`);
  return applied;
}

/**
 * Ranks candidates against stated criteria.
 *
 * With no criteria at all every candidate matches equally and the order is the
 * order it was given in — the honest answer to "show me everything" is
 * everything, not an arbitrary ranking dressed as a recommendation.
 */
export function match(candidates: readonly Candidate[], criteria: MatchCriteria): MatchOutcome {
  const matches: MatchResult[] = [];
  const excluded: Exclusion[] = [];

  for (const candidate of candidates) {
    const dealbreaker = passesDealbreakers(candidate, criteria);
    if (dealbreaker !== null) {
      excluded.push({ candidate, because: dealbreaker });
      continue;
    }

    const reasons = scoreCandidate(candidate, criteria);
    const fit =
      reasons.length === 0
        ? 1
        : reasons.reduce((total, reason) => total + reason.satisfaction * WEIGHT, 0) /
          (reasons.length * WEIGHT);

    matches.push({ candidate, fit, reasons });
  }

  // Stable: equal fit keeps input order, so a tie never looks like a ranking.
  matches.sort((a, b) => b.fit - a.fit);

  return { matches, excluded, applied: describeCriteria(criteria) };
}
