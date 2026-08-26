/**
 * Percentile bars — SPEC.md §8.5.
 *
 * Where a bar is drawn next to a number, **the bar's length is that value's
 * percentile within a stated comparison set**, and the label is the real value
 * with its real unit:
 *
 *   "Free recoil 8.4 J · 62nd percentile among centrefire rifles"
 *
 * Never a normalised 0–100 score. Game weapon screens run on invented balance
 * numbers; this site borrows their legibility and none of their epistemology.
 * The bar is a position in a real population, the number beside it is a
 * measurement, and the population is named — so a reader who thinks the
 * comparison set is the wrong one can say so.
 *
 * Pure. No DOM, no I/O, no framework import.
 */

export interface ComparisonSet {
  /** Shown to the reader, e.g. 'centrefire rifles'. Never omitted. */
  label: string;
  /** The population. Entries with no value are excluded before it gets here. */
  values: readonly number[];
}

export interface PercentileResult {
  /** 0–1. Multiply by 100 for the label, by the track width for the bar. */
  fraction: number;
  /** 1–100, rounded, for the prose label. */
  percentile: number;
  /** How many entries the position is measured against. */
  populationSize: number;
  setLabel: string;
  /** Position within the set, 1 = lowest value. */
  rank: number;
}

/**
 * Mid-rank percentile: the fraction of the population below the value, plus
 * half of those equal to it.
 *
 * The half-credit for ties is what stops a set where a third of the entries
 * share a value from rendering them all at either 0% or 66%. Both of the
 * simpler definitions produce a bar that jumps for no visible reason when one
 * entry's figure is corrected by a rounding.
 */
export function percentileOf(value: number, set: ComparisonSet): PercentileResult | null {
  const values = set.values.filter((v) => Number.isFinite(v));
  if (values.length === 0) return null;

  let below = 0;
  let equal = 0;
  for (const other of values) {
    if (other < value) below += 1;
    else if (other === value) equal += 1;
  }

  const fraction = (below + equal / 2) / values.length;
  const sorted = [...values].sort((a, b) => a - b);

  return {
    fraction,
    percentile: Math.max(1, Math.min(100, Math.round(fraction * 100))),
    populationSize: values.length,
    setLabel: set.label,
    rank: sorted.findIndex((v) => v >= value) + 1,
  };
}

/**
 * The sentence that goes under the bar.
 *
 * Built here rather than in a component so every bar on the site says the same
 * thing the same way, including the part that names the comparison set. A bar
 * whose population is unstated is exactly the unitless score SPEC.md §8.5
 * rejects.
 */
export function describePercentile(
  result: PercentileResult,
  value: number,
  unit: string,
  decimals = 1,
): string {
  const formatted = `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
  return `${formatted} · ${ordinal(result.percentile)} percentile among ${result.setLabel} (n = ${result.populationSize})`;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * The whole ladder, for a page that ranks a population rather than placing one
 * entry in it — the recoil ladder of SPEC.md §8.1, for instance.
 *
 * Returns entries in ascending order of value, each with its own percentile,
 * so the caller renders a list and never re-derives a position.
 */
export function ladder<T>(
  entries: readonly T[],
  valueOf: (entry: T) => number | null,
  setLabel: string,
): { entry: T; value: number; result: PercentileResult }[] {
  const withValues = entries
    .map((entry) => ({ entry, value: valueOf(entry) }))
    .filter((row): row is { entry: T; value: number } => row.value !== null && Number.isFinite(row.value));

  const set: ComparisonSet = { label: setLabel, values: withValues.map((row) => row.value) };

  return withValues
    .map((row) => ({ ...row, result: percentileOf(row.value, set)! }))
    .sort((a, b) => a.value - b.value);
}
