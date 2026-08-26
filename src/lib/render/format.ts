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
 * Decimal places per SI unit, chosen so a figure carries the precision its
 * source actually had and no more. A barrel length published as 114 mm should
 * not render as 114.00 mm, and a ballistic coefficient of 0.243 must not
 * collapse to 0.2.
 */
const DECIMALS: Record<string, { metric: number; imperial: number }> = {
  mm: { metric: 1, imperial: 2 },
  m: { metric: 0, imperial: 0 },
  g: { metric: 2, imperial: 1 },
  kg: { metric: 3, imperial: 2 },
  'm/s': { metric: 0, imperial: 0 },
  J: { metric: 0, imperial: 0 },
  N: { metric: 1, imperial: 1 },
  MPa: { metric: 0, imperial: 0 },
  rpm: { metric: 0, imperial: 0 },
  mrad: { metric: 2, imperial: 2 },
  '': { metric: 0, imperial: 0 },
};

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

  const decimals = DECIMALS[siUnit] ?? { metric: 2, imperial: 2 };
  const metricText = `${formatNumber(value, decimals.metric)}${siUnit ? ` ${siUnit}` : ''}`;

  const rule = IMPERIAL_FOR[siUnit];
  if (!rule) return { metric: metricText, imperial: metricText, identical: true };

  const converted = rule.convert(value);
  const imperialText = `${formatNumber(converted, decimals.imperial)}${rule.unit ? ` ${rule.unit}` : ''}`;

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
