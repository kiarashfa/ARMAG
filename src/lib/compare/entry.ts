/**
 * Reading a row's value off an entry — the other half of `rows.ts`.
 *
 * `rows.ts` says what rows exist; this says what each one holds for one entry,
 * and returns it as a **serialisable cell**. That shape is what lets the same
 * reading feed two very different consumers without being written twice:
 *
 *   - the gun page's spec table, rendered at build time from the cells;
 *   - `/compare/data/<slug>.json`, fetched by the compare island at runtime.
 *
 * Both come through `buildCompareEntry`, so a figure cannot read one way in the
 * spec table and another way in the comparison — the failure that made a shared
 * registry worth building in the first place (SPEC.md §9.2).
 *
 * ── Why the percentile is baked in ─────────────────────────────────────────
 * SPEC.md §8.5 requires a bar's length to be a percentile **within a stated
 * comparison set**. The set is the whole database, which the client does not
 * have and must not have to download. So the position is computed at build time
 * from every entry and travels with the cell, along with the size and name of
 * the population it was measured against — a bar whose population is unstated
 * is exactly the unitless score §8.5 rejects.
 */
import type { CartridgeData } from '../../schemas/cartridge.ts';
import type { GunData } from '../../schemas/gun.ts';
import type { PropertyValue } from '../../schemas/primitives.ts';
import { labelFor } from '../../schemas/taxonomy.ts';
import { percentileOf } from '../math/percentile.ts';
import type { Derived, ValueStatus } from '../math/provenance.ts';
import { figuresForGun } from '../content/derived.ts';
import { humanise } from '../render/format.ts';
import type { CompareRow } from './rows.ts';

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export interface PercentileCell {
  /** 0–1. The bar's length. */
  fraction: number;
  /** 1–100, for the label. */
  percentile: number;
  populationSize: number;
  setLabel: string;
}

export type CompareCell =
  | {
      kind: 'scalar';
      value: number | null;
      unit: string;
      status: ValueStatus;
      source?: string;
      sourceUrl?: string;
      sourceNote?: string;
      percentile?: PercentileCell;
    }
  | { kind: 'derived'; derived: Derived; percentile?: PercentileCell }
  | { kind: 'enum'; term: string | null; label: string | null }
  | { kind: 'list'; terms: { id: string; label: string }[] }
  | { kind: 'number'; value: number | null; percentile?: PercentileCell }
  | { kind: 'text'; text: string | null }
  | { kind: 'years'; start: number | null; end: number | null }
  | {
      kind: 'money';
      amount: number | null;
      currency: string;
      market: string;
      year: number;
      status: ValueStatus;
    };

export interface CompareEntry {
  id: string;
  name: string;
  nativeName?: string;
  type: string | null;
  typeLabel: string | null;
  makerId: string | null;
  makerName: string | null;
  cartridgeName: string | null;
  /** False below the publication floor — a column, but no link (SPEC.md §5.9). */
  hasPage: boolean;
  cells: Record<string, CompareCell>;
}

// ---------------------------------------------------------------------------
// Populations
// ---------------------------------------------------------------------------

/**
 * How many entries a type must contribute before it is used as the comparison
 * set rather than the whole database.
 *
 * Below this the set is too small for a percentile to mean anything — "3rd of
 * 4 revolvers" reads as a ranking, not a position — so the bar falls back to
 * every entry and says so.
 */
const MIN_TYPED_POPULATION = 5;

export interface Populations {
  /** Row key → every value in the database, and every value per type. */
  all: Record<string, number[]>;
  byType: Record<string, Record<string, number[]>>;
}

const numberIn = (cell: CompareCell | undefined): number | null => {
  if (!cell) return null;
  if (cell.kind === 'scalar' || cell.kind === 'number') return cell.value;
  if (cell.kind === 'derived') return cell.derived.value;
  return null;
};

/**
 * Every numeric row's population, over every entry.
 *
 * Built once per build and handed to `buildCompareEntry`, rather than
 * recomputed per entry: at three thousand entries the difference is one pass
 * versus three thousand.
 */
export function buildPopulations(
  rows: readonly CompareRow[],
  entries: readonly { type: string | null; cells: Record<string, CompareCell> }[],
): Populations {
  const all: Record<string, number[]> = {};
  const byType: Record<string, Record<string, number[]>> = {};

  for (const row of rows) {
    if (!row.numeric) continue;
    all[row.key] = [];
    byType[row.key] = {};
  }

  for (const entry of entries) {
    for (const row of rows) {
      if (!row.numeric) continue;
      const value = numberIn(entry.cells[row.key]);
      if (value === null || !Number.isFinite(value)) continue;
      all[row.key]!.push(value);
      if (entry.type) {
        const bucket = byType[row.key]!;
        (bucket[entry.type] ??= []).push(value);
      }
    }
  }

  return { all, byType };
}

/** The position of one value in the set that best describes it. */
export function percentileFor(
  populations: Populations,
  rowKey: string,
  type: string | null,
  value: number | null,
): PercentileCell | undefined {
  if (value === null || !Number.isFinite(value)) return undefined;

  const typed = type ? populations.byType[rowKey]?.[type] : undefined;
  const useTyped = typed !== undefined && typed.length >= MIN_TYPED_POPULATION;
  const values = useTyped ? typed! : (populations.all[rowKey] ?? []);
  const setLabel =
    useTyped && type ? `${labelFor('type', type) ?? humanise(type)} entries` : 'all entries';

  const result = percentileOf(value, { label: setLabel, values });
  if (!result) return undefined;

  return {
    fraction: result.fraction,
    percentile: result.percentile,
    populationSize: result.populationSize,
    setLabel: result.setLabel,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const propertyCell = (value: PropertyValue | undefined | null, unit: string): CompareCell =>
  value
    ? {
        kind: 'scalar',
        value: value.value,
        unit: value.unit ?? unit,
        status: value.status,
        source: value.source,
        sourceUrl: value.sourceUrl,
        sourceNote: value.sourceNote,
      }
    : { kind: 'scalar', value: null, unit, status: 'placeholder' };

/**
 * Enum values that are not taxonomy terms and whose correct rendering is not a
 * sentence-cased slug.
 *
 * `humanise` turned `cip` into "Cip" — a standards body the reader would have
 * to guess at. There is no vocabulary file for these because they are not
 * browsable axes; they are the enums a standards field carries.
 */
const ACRONYM_LABELS: Record<string, string> = {
  saami: 'SAAMI',
  cip: 'C.I.P.',
  nato: 'NATO',
  none: 'No standards body',
};

const termCell = (id: string | undefined | null, axis?: string): CompareCell => ({
  kind: 'enum',
  term: id ?? null,
  label: id ? ((axis && labelFor(axis, id)) ?? ACRONYM_LABELS[id] ?? humanise(id)) : null,
});

/**
 * One row's value, read off a plain data object by the row's own key.
 *
 * The accessor is `source[row.key]` and nothing more — which is precisely why a
 * new schema field needs no edit anywhere. `derived` rows are the one exception
 * and read from the figures map instead, because a derived figure is not a
 * field on the entry.
 */
export function readCell(
  row: CompareRow,
  source: Record<string, unknown>,
  figures: Record<string, Derived> = {},
): CompareCell {
  const raw = source[row.key];

  switch (row.kind) {
    case 'derived': {
      const derived = figures[row.key];
      return {
        kind: 'derived',
        derived: derived ?? {
          value: null,
          status: 'placeholder',
          unit: row.unit ?? '',
          formula: 'not computed for this entry',
          inputs: [],
          assumptions: [],
          blockedBy: row.label.toLowerCase(),
        },
      };
    }
    case 'scalar':
      return propertyCell(raw as PropertyValue | undefined, row.unit ?? '');
    case 'enum':
      return termCell(raw as string | undefined, row.axis);
    case 'list': {
      const ids = Array.isArray(raw) ? (raw as string[]) : [];
      return {
        kind: 'list',
        terms: ids.map((id) => ({
          id,
          label: (row.axis && labelFor(row.axis, id)) || humanise(id),
        })),
      };
    }
    case 'number':
      return { kind: 'number', value: typeof raw === 'number' ? raw : null };
    case 'text':
      return { kind: 'text', text: typeof raw === 'string' ? raw : null };
    case 'years': {
      const range = raw as { start: number; end: number | null } | undefined;
      return { kind: 'years', start: range?.start ?? null, end: range?.end ?? null };
    }
    case 'money': {
      const money = raw as
        | { amount: number | null; currency: string; market: string; year: number; status: ValueStatus }
        | undefined;
      return money
        ? {
            kind: 'money',
            amount: money.amount,
            currency: money.currency,
            market: money.market,
            year: money.year,
            status: money.status,
          }
        : { kind: 'money', amount: null, currency: '', market: '', year: 0, status: 'placeholder' };
    }
  }
}

/**
 * Every row's cell for any entry that has no derived layer — a cartridge, say.
 *
 * The gun path goes through `buildCompareEntry`, which adds the figures and the
 * percentiles on top of this. Both end at `readCell`, so the cartridge page's
 * table and the gun page's table are the same code reading the same way.
 */
export function buildCells(
  rows: readonly CompareRow[],
  source: Record<string, unknown>,
  figures: Record<string, Derived> = {},
): Record<string, CompareCell> {
  const cells: Record<string, CompareCell> = {};
  for (const row of rows) cells[row.key] = readCell(row, source, figures);
  return cells;
}

export interface EntryContext {
  makerName?: string | null;
  cartridgeName?: string | null;
  cartridge?: CartridgeData | null;
  hasPage?: boolean;
  populations?: Populations;
}

/**
 * Every cell for one gun, ready to render or to serialise.
 *
 * Called twice per entry over a build — once for the page, once for the compare
 * endpoint — and that is deliberate. Caching it would save a few milliseconds
 * and reintroduce exactly the risk this module removes: two readings of the
 * same field that could drift apart.
 */
export function buildCompareEntry(
  rows: readonly CompareRow[],
  gun: GunData,
  context: EntryContext = {},
): CompareEntry {
  const figures = figuresForGun(gun, context.cartridge).byKey;
  const cells = buildCells(rows, gun as unknown as Record<string, unknown>, figures);

  for (const row of rows) {
    const cell = cells[row.key]!;
    if (context.populations && row.numeric) {
      const position = percentileFor(
        context.populations,
        row.key,
        gun.type ?? null,
        numberIn(cell),
      );
      if (position && (cell.kind === 'scalar' || cell.kind === 'derived' || cell.kind === 'number')) {
        cell.percentile = position;
      }
    }
  }

  return {
    id: gun.id,
    name: gun.name,
    nativeName: gun.nativeName,
    type: gun.type ?? null,
    typeLabel: gun.type ? ((labelFor('type', gun.type) ?? humanise(gun.type))) : null,
    makerId: gun.makerRef,
    makerName: context.makerName ?? null,
    cartridgeName: context.cartridgeName ?? null,
    hasPage: context.hasPage ?? true,
    cells,
  };
}
