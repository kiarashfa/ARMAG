/**
 * Number and value formatting — the last step before a figure reaches a reader.
 *
 * ── How the unit toggle works, and why it is not an island ─────────────────
 * SPEC.md §11 wants a persistent imperial toggle. The obvious implementation is
 * a Svelte island that recomputes every figure on the page; this site does
 * something cheaper and better instead: **both values are rendered into the
 * HTML, and CSS shows one of them.** The toggle sets `data-units` on `<html>`
 * and that is the whole mechanism.
 *
 * It costs a few hundred bytes of markup per page and buys four things a
 * client-side converter cannot: it works with JavaScript disabled (metric, the
 * default), it switches instantly with no hydration and no layout shift, the
 * server-rendered figure and the toggled one are the same string so they can
 * never disagree, and the imperial half carries `data-pagefind-ignore` so
 * imperial values are still never indexed — SPEC.md §8.1's rule that imperial
 * is computed and never stored or indexed is kept exactly.
 */
import { IMPERIAL_FOR, type UnitSystem } from '../math/units.ts';

export type { UnitSystem };

/**
 * How many decimal places a figure is shown to.
 *
 * ── Two rules, and the smaller one wins ────────────────────────────────────
 *
 * 1. **Never more precision than the source had.** A case length published as
 *    19.15 mm is shown as 19.15 mm; a barrel length published as 114 mm is
 *    shown as 114 mm, not 114.0. The number of decimals actually present in the
 *    stored value is the ceiling, because inventing a trailing digit is a
 *    small, silent version of inventing a figure.
 *
 * 2. **Never more than four significant figures.** A derived value is a float
 *    and carries fourteen meaningless decimals; four significant figures is
 *    past the precision any input to it had.
 *
 * Between them these replace the fixed per-unit table this file used to carry,
 * which was right at the magnitude a unit usually holds and wrong at the other
 * end of it — free recoil rendered as "4 J" beside a muzzle energy of
 * "3,629 J", and a sourced 19.15 mm rendered as 19.1 mm, losing a digit the
 * standards datasheet actually published.
 *
 * The imperial figure has no stored precision to respect, because it is
 * computed, so only the significant-figure rule applies to it.
 */
const SIGNIFICANT_FIGURES = 4;

/** Decimals needed to show `value` to `SIGNIFICANT_FIGURES`, floored at zero. */
function significantDecimals(value: number): number {
  if (value === 0) return 0;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  return Math.max(0, Math.min(6, SIGNIFICANT_FIGURES - 1 - magnitude));
}

/** Decimals actually present in a stored figure — its published precision. */
function storedDecimals(value: number): number {
  const text = String(value);
  if (text.includes('e') || text.includes('E')) return 6;
  const point = text.indexOf('.');
  return point === -1 ? 0 : text.length - point - 1;
}

/** Thousands separators, so a four-digit energy figure is readable at a glance. */
export function formatNumber(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(decimals));
  return rounded.toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export interface FormattedValue {
  metric: string;
  imperial: string;
  /** True when the two systems render identically — a count, a rate. */
  identical: boolean;
}

/**
 * One SI value, formatted for both systems.
 *
 * A dimensionless value renders as a bare number in both, which is why
 * `identical` exists: capacity, ballistic coefficient and cyclic rate should
 * not be wrapped in a toggle that does nothing.
 */
export function formatValue(value: number | null, siUnit: string): FormattedValue | null {
  if (value === null || !Number.isFinite(value)) return null;

  const metricText = `${formatNumber(
    value,
    Math.min(storedDecimals(value), significantDecimals(value)),
  )}${siUnit ? ` ${siUnit}` : ''}`;

  const rule = IMPERIAL_FOR[siUnit];
  if (!rule) return { metric: metricText, imperial: metricText, identical: true };

  const converted = rule.convert(value);
  // A rate and a count are the same figure in both systems, so they keep the
  // stored precision too — otherwise a capacity of 17 renders as "17.00" the
  // moment a reader switches to imperial.
  const imperialDecimals =
    converted === value
      ? Math.min(storedDecimals(value), significantDecimals(value))
      : significantDecimals(converted);
  const imperialText = `${formatNumber(converted, imperialDecimals)}${
    rule.unit ? ` ${rule.unit}` : ''
  }`;

  return {
    metric: metricText,
    imperial: imperialText,
    identical: metricText === imperialText,
  };
}

/** A production range, with an open end for anything still being made. */
export function formatYears(range?: { start: number; end: number | null } | null): string | null {
  if (!range) return null;
  return range.end === null ? `${range.start}–present` : `${range.start}–${range.end}`;
}

/** Sentence-case a taxonomy id when no vocabulary label is to hand. */
export const humanise = (id: string): string =>
  id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** A count with its noun, pluralised the boring correct way. */
export const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : pluralForm}`;
