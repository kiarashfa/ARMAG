/**
 * Money — SPEC.md §8.1 and §9.4.
 *
 * ── What this module is allowed to know ────────────────────────────────────
 * SPEC.md §16 rejects a market-value database outright: it is unobtainable
 * freely, stale immediately, and pretending otherwise would put a wrong number
 * in front of someone about to spend real money. What the site has instead is
 * two honest things — a **launch price as published**, adjusted for inflation
 * from a baked CPI table, and a **condition calculator applied to a base the
 * reader supplies**. This module does those two things and nothing that looks
 * like an appraisal.
 *
 * The CPI table is passed in, never read from disk: `lib/math` does no I/O
 * (Instruction.md Phase 3), and the table itself is baked into
 * `src/data/cpi.json` in Phase 9 so the built site makes no runtime API call.
 *
 * Pure. No DOM, no I/O, no framework import.
 */
import { derive, given, type Derived, type ValueLike } from './provenance.ts';

/** Annual average CPI, keyed by year. Whatever series the caller baked. */
export type CpiTable = Readonly<Record<string, number>>;

/**
 * A published price adjusted to another year's money.
 *
 * Returns `null` — not an approximation — when either year is missing from the
 * table. A CPI table that stops in 1913 cannot tell you what an 1890 rifle cost
 * in today's money, and the honest reply to that is that it cannot.
 */
export function adjustForInflation(
  amount: ValueLike,
  fromYear: number,
  toYear: number,
  cpi: CpiTable,
): Derived {
  const from = cpi[String(fromYear)];
  const to = cpi[String(toYear)];
  const known = from !== undefined && to !== undefined && from > 0;

  return derive({
    formula: `amount × CPI(${toYear}) / CPI(${fromYear})`,
    unit: '',
    inputs: [
      { label: 'amount', of: amount },
      {
        label: `CPI(${fromYear})`,
        of: known
          ? given(from!, '', 'US Bureau of Labor Statistics annual average')
          : { value: null, status: 'placeholder' },
      },
      {
        label: `CPI(${toYear})`,
        of: known
          ? given(to!, '', 'US Bureau of Labor Statistics annual average')
          : { value: null, status: 'placeholder' },
      },
    ],
    assumptions: [
      'General consumer price inflation. Firearms are not a CPI basket category, so this says what the money is worth, not what the market did.',
    ],
    compute: ([value, fromCpi, toCpi]) => (value! * toCpi!) / fromCpi!,
  });
}

/** Cost per round from a pack price — the arithmetic everyone does by hand. */
export function costPerRound(packPrice: ValueLike, roundsPerPack: ValueLike): Derived {
  return derive({
    formula: 'pack price / rounds per pack',
    unit: '',
    inputs: [
      { label: 'pack price', of: packPrice },
      { label: 'rounds', of: roundsPerPack, unit: '' },
    ],
    compute: ([price, rounds]) => (rounds! === 0 ? 0 : price! / rounds!),
  });
}

/** Cost of firing a magazine dry, at a stated cost per round. */
export function costPerMagazine(costPerRoundValue: ValueLike, capacity: ValueLike): Derived {
  return derive({
    formula: 'cost per round × capacity',
    unit: '',
    inputs: [
      { label: 'cost per round', of: costPerRoundValue },
      { label: 'capacity', of: capacity, unit: '' },
    ],
    compute: ([cost, capacity_]) => cost! * capacity_!,
  });
}

/**
 * The NRA condition scale — SPEC.md §9.4.
 *
 * The grade names carry their own percentages, and those percentages are the
 * multiplier: "Excellent (95%)" is a published description of remaining
 * original finish and function, and applying it linearly to a base value is a
 * stated convention, not a market model. **The base is always the reader's
 * own.** The site never supplies one, which is the whole reason this is
 * defensible.
 */
export const NRA_CONDITION_MULTIPLIER = {
  'new-100': 1.0,
  'excellent-95': 0.95,
  'fine-80': 0.8,
  'very-good-70': 0.7,
  'good-60': 0.6,
  'fair-40': 0.4,
  'poor-30': 0.3,
} as const;

export type NraConditionGrade = keyof typeof NRA_CONDITION_MULTIPLIER;

export function conditionAdjustedValue(
  baseValue: ValueLike,
  grade: NraConditionGrade,
): Derived {
  return derive({
    formula: `base value × ${NRA_CONDITION_MULTIPLIER[grade]} (NRA ${grade})`,
    unit: '',
    inputs: [
      { label: 'base value', of: baseValue },
      { label: 'condition', of: given(NRA_CONDITION_MULTIPLIER[grade], '') },
    ],
    assumptions: [
      'The base value is yours, not ours: ARMAG holds no market-value data (SPEC.md §16).',
      'The NRA grade percentage is applied linearly. It describes condition, and real markets do not price condition linearly — treat this as a scale, not a valuation.',
    ],
    compute: ([base, multiplier]) => base! * multiplier!,
  });
}

/**
 * Rounds fired per unit of currency — a fair way to compare the running cost of
 * two chamberings, which is often a bigger number over a year than the arm was.
 */
export function roundsPerUnitCost(costPerRoundValue: ValueLike): Derived {
  return derive({
    formula: '1 / cost per round',
    unit: '',
    inputs: [{ label: 'cost per round', of: costPerRoundValue }],
    compute: ([cost]) => (cost! === 0 ? 0 : 1 / cost!),
  });
}
