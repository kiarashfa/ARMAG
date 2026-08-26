/**
 * The row registry — SPEC.md §9.2, and Instruction.md Phase 6's definition of
 * done: *"adding a field to `gun.ts` makes it appear in both the spec table and
 * the compare table without any other edit."*
 *
 * That sentence rules out the obvious implementation. A hand-written array of
 * `{ key, label, unit }` is one more file to remember, and the failure mode
 * when someone forgets is silent: the field exists, validates, renders nowhere,
 * and nobody notices for months. So **the registry is read out of the Zod
 * schema itself.** A new `propertyValue('mm')` field appears in both tables the
 * moment it is added, with the right unit, because the unit is read off the
 * `z.literal` the schema already pins to it.
 *
 * ── The teeth ──────────────────────────────────────────────────────────────
 * Classification is total. Every field either becomes a row, or is named in a
 * `SKIP` map with its reason, or lands in `unclassified` — and `rows.test.ts`
 * fails when `unclassified` is not empty. A field shaped like something this
 * file cannot render stops the build asking to be classified rather than being
 * silently dropped.
 *
 * ── What this file must never learn ────────────────────────────────────────
 * Nothing here reads content. It describes *what rows exist*; `entry.ts` reads
 * the values. That split is what lets the metadata be serialised into a client
 * island as a prop while the reading of content stays at build time.
 */
import { cartridgeDataSchema } from '../../schemas/cartridge.ts';
import { gunDataSchema } from '../../schemas/gun.ts';
import { GUN_FIGURES } from '../content/derived.ts';

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

/**
 * SPEC.md §9.2 names four row types — scalar, enum, list, derived. The other
 * four exist because the schema has four shapes that are none of those and are
 * still worth comparing: a bare year, a production range, a price, and free
 * text such as a cartridge's designer.
 */
export type RowKind = 'scalar' | 'enum' | 'list' | 'number' | 'text' | 'years' | 'money' | 'derived';

export interface CompareRow {
  /** The schema field name, or the derived figure's key. */
  key: string;
  label: string;
  group: string;
  kind: RowKind;
  /** SI unit — `scalar` and `derived` only. */
  unit?: string;
  /** Taxonomy axis — `enum` and `list` only, so term labels resolve. */
  axis?: string;
  /** True where a percentile bar is meaningful: a number within a population. */
  numeric: boolean;
}

// ---------------------------------------------------------------------------
// Zod introspection
// ---------------------------------------------------------------------------

/**
 * Zod 4 exposes a schema's definition at `_zod.def`, and an object's fields at
 * `_zod.def.shape` in declaration order. Reaching for an internal is a real
 * cost, and it is paid here rather than in a hand-kept list because the
 * alternative fails silently and this fails loudly: if the internal shape ever
 * changes, `registryFrom` classifies nothing and `rows.test.ts` reports every
 * field at once.
 */
type ZodDef = { type?: string; [key: string]: unknown };
/**
 * `def` is `unknown` rather than a record: Zod's own definition types have no
 * index signature, so a narrower declaration here makes every real schema
 * fail to assign. The cast is contained to `defOf` and to nowhere else.
 */
type AnySchema = { _zod?: { def?: unknown } };

const defOf = (schema: AnySchema | undefined): ZodDef | undefined =>
  schema?._zod?.def as ZodDef | undefined;

const WRAPPERS = ['optional', 'default', 'nullable', 'nonoptional', 'prefault', 'readonly', 'catch'];

/** Peels the wrappers a field may be declared behind to reach its real type. */
function unwrap(schema: AnySchema): AnySchema {
  let current = schema;
  for (let depth = 0; depth < 12; depth += 1) {
    const def = defOf(current);
    if (!def || !WRAPPERS.includes(def.type as string)) return current;
    current = def.innerType as AnySchema;
  }
  return current;
}

const shapeOf = (def: ZodDef | undefined): Record<string, AnySchema> =>
  (def?.shape as Record<string, AnySchema>) ?? {};

const isPropertyValue = (def: ZodDef | undefined): boolean =>
  def?.type === 'object' &&
  shapeOf(def).value !== undefined &&
  shapeOf(def).status !== undefined &&
  defOf(shapeOf(def).unit)?.type === 'literal';

const unitOf = (def: ZodDef): string =>
  String((defOf(shapeOf(def).unit)?.values as unknown[])?.[0] ?? '');

const isMoney = (def: ZodDef | undefined): boolean =>
  def?.type === 'object' &&
  shapeOf(def).amount !== undefined &&
  shapeOf(def).currency !== undefined;

const isYearRange = (def: ZodDef | undefined): boolean =>
  def?.type === 'object' &&
  Object.keys(shapeOf(def)).length === 2 &&
  shapeOf(def).start !== undefined &&
  shapeOf(def).end !== undefined;

// ---------------------------------------------------------------------------
// Presentation — the only hand-maintained part, and none of it is required
// ---------------------------------------------------------------------------

/**
 * camelCase to a sentence. This is the default label for any field nobody has
 * named, and it is what makes a brand-new schema field render legibly with no
 * edit in this file at all.
 */
export function labelFromKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Overrides, only where the derived label reads badly. Optional, always. */
const LABELS: Record<string, string> = {
  massEmpty: 'Mass, empty',
  massMagazineEmpty: 'Magazine, empty',
  lengthFolded: 'Length, folded',
  riflingGrooves: 'Grooves',
  productionTotal: 'Units produced',
  fireModes: 'Fire modes',
  feedSystem: 'Feed',
  operatingSystem: 'Operating system',
  designedIn: 'Designed in',
  producedIn: 'Produced in',
  productionYears: 'Production',
  launchPrice: 'Launch price',
  caseType: 'Case type',
  caseShape: 'Case shape',
  standard: 'Standards body',
  pressureStandard: 'Pressure standard',
  maxPressure: 'Maximum pressure',
  designedBy: 'Designed by',
};

/**
 * Which panel of the spec table a row sits in. A field with no entry here
 * lands in `OTHER_GROUP` — visibly, at the end of the table, rather than lost.
 */
const GUN_GROUPS: Record<string, string> = {
  type: 'Identity',
  action: 'Identity',
  operatingSystem: 'Identity',
  fireModes: 'Identity',
  feedSystem: 'Identity',
  roles: 'Identity',
  designedIn: 'Identity',
  producedIn: 'Identity',
  introduced: 'Identity',
  productionYears: 'Identity',

  massEmpty: 'Dimensions and mass',
  massMagazineEmpty: 'Dimensions and mass',
  length: 'Dimensions and mass',
  lengthFolded: 'Dimensions and mass',
  width: 'Dimensions and mass',
  height: 'Dimensions and mass',
  barrelLength: 'Dimensions and mass',

  sightRadius: 'Sights and rifling',
  sightHeightOverBore: 'Sights and rifling',
  riflingTwist: 'Sights and rifling',
  twistDirection: 'Sights and rifling',
  riflingGrooves: 'Sights and rifling',
  sightGraduation: 'Sights and rifling',

  cyclicRate: 'Operation',
  triggerPull: 'Operation',
  effectiveRange: 'Operation',
  productionTotal: 'Operation',
  launchPrice: 'Operation',
};

const CARTRIDGE_GROUPS: Record<string, string> = {
  introduced: 'Identity',
  productionYears: 'Identity',
  designedBy: 'Identity',
  standard: 'Identity',
  caseType: 'Identity',
  caseShape: 'Identity',

  bulletDiameter: 'Dimensions',
  caseLength: 'Dimensions',
  overallLength: 'Dimensions',
  rimDiameter: 'Dimensions',
  neckDiameter: 'Dimensions',
  baseDiameter: 'Dimensions',

  maxPressure: 'Pressure',
  pressureStandard: 'Pressure',
};

const OTHER_GROUP = 'Other specifications';

/** Which vocabulary an enum field's terms come from, where it is a taxonomy. */
const AXES: Record<string, string> = {
  type: 'type',
  action: 'action',
  operatingSystem: 'operating-system',
  fireModes: 'fire-mode',
  feedSystem: 'feed',
  roles: 'role',
  designedIn: 'country',
  producedIn: 'country',
};

/**
 * Fields that are deliberately not rows, each with the reason.
 *
 * The reason is not decoration: `rows.test.ts` asserts every key here still
 * names a field in the schema, so a renamed field cannot leave a stale
 * exemption quietly suppressing a row that ought to have appeared.
 */
const GUN_SKIP: Record<string, string> = {
  id: 'the slug, not a fact about the arm',
  name: 'the column heading itself',
  nativeName: 'rendered in the hero, under the display name',
  kind: 'family versus model is structure, not specification',
  wikidataId: 'a join key for our own tooling',
  makerRef: 'rendered as a link in the hero and in the compare column heading',
  familyRef: 'rendered in the lineage section as a link',
  alsoInFamilies: 'secondary groupings, rendered with the lineage graph',
  aliases: 'rendered as the "also known as" line',
  lineage: 'the lineage graph is its own section',
  chamberings: 'many-to-many, with a capacity per row — its own block',
  variants: 'the variant tabs and the delta table',
  fits: 'accessory compatibility edges; the accessories collection is v2',
  images: 'the hero and the gallery',
  model3d: 'reserved for the v2 range',
  lastVerified: 'entry-level provenance, printed under the references',
  reviewStatus: 'entry-level provenance, printed under the references',
  references: "the entry's own bibliography",
};

const CARTRIDGE_SKIP: Record<string, string> = {
  id: 'the slug, not a fact about the cartridge',
  name: 'the column heading itself',
  nativeName: 'rendered in the hero, under the display name',
  wikidataId: 'a join key for our own tooling',
  aliases: 'rendered as the "also known as" line',
  loads: 'a table of its own — one row per load, not one cell',
  images: 'the hero and the gallery',
  lastVerified: 'entry-level provenance, printed under the references',
  reviewStatus: 'entry-level provenance, printed under the references',
  references: "the entry's own bibliography",
};

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export interface RegistryOptions {
  skip: Record<string, string>;
  groups: Record<string, string>;
}

export interface Registry {
  rows: CompareRow[];
  /**
   * Fields this file could neither render nor account for. Empty in a green
   * build; `rows.test.ts` is what keeps it that way.
   */
  unclassified: string[];
  /** Skip keys that no longer name a field. Also always empty. */
  staleSkips: string[];
}

/**
 * Reads a Zod object schema and returns the rows it implies.
 *
 * Field order is the schema's own declaration order, which is why `gunSpec`'s
 * measurements arrive before the identity fields it was extended with. The
 * group map, not this function, decides what a reader sees first.
 */
export function registryFrom(schema: AnySchema, options: RegistryOptions): Registry {
  const shape = shapeOf(defOf(schema));
  const rows: CompareRow[] = [];
  const unclassified: string[] = [];

  for (const [key, field] of Object.entries(shape)) {
    if (key in options.skip) continue;

    const def = defOf(unwrap(field));
    const label = LABELS[key] ?? labelFromKey(key);
    const group = options.groups[key] ?? OTHER_GROUP;
    const axis = AXES[key];

    if (isPropertyValue(def)) {
      rows.push({ key, label, group, kind: 'scalar', unit: unitOf(def!), numeric: true });
    } else if (isMoney(def)) {
      rows.push({ key, label, group, kind: 'money', numeric: false });
    } else if (isYearRange(def)) {
      rows.push({ key, label, group, kind: 'years', numeric: false });
    } else if (def?.type === 'enum') {
      rows.push({ key, label, group, kind: 'enum', axis, numeric: false });
    } else if (def?.type === 'array' && defOf(unwrap(def.element as AnySchema))?.type === 'enum') {
      rows.push({ key, label, group, kind: 'list', axis, numeric: false });
    } else if (def?.type === 'number') {
      rows.push({ key, label, group, kind: 'number', numeric: true });
    } else if (def?.type === 'string') {
      rows.push({ key, label, group, kind: 'text', numeric: false });
    } else {
      unclassified.push(key);
    }
  }

  const staleSkips = Object.keys(options.skip).filter((key) => !(key in shape));
  return { rows, unclassified, staleSkips };
}

// ---------------------------------------------------------------------------
// The two registries, and the derived rows that sit alongside the gun's
// ---------------------------------------------------------------------------

export const GUN_REGISTRY = registryFrom(gunDataSchema, { skip: GUN_SKIP, groups: GUN_GROUPS });

export const CARTRIDGE_REGISTRY = registryFrom(cartridgeDataSchema, {
  skip: CARTRIDGE_SKIP,
  groups: CARTRIDGE_GROUPS,
});

export const DERIVED_GROUP = 'Derived figures';

/**
 * The derived rows, taken from `derived.ts` rather than restated here.
 *
 * Same rule as the schema rows, for the same reason: a figure added to the math
 * seam appears in the compare table on its own, and cannot be added in one
 * place and forgotten in the other.
 */
export const GUN_DERIVED_ROWS: CompareRow[] = GUN_FIGURES.map((figure) => ({
  key: figure.key,
  label: figure.label,
  group: DERIVED_GROUP,
  kind: 'derived' as const,
  unit: figure.unit,
  numeric: true,
}));

/**
 * Every row a gun comparison shows, derived figures first.
 *
 * They lead for the same reason the ƒ panel sits above the spec table on a gun
 * page (SPEC.md §11): the spec sheet is table stakes, the computed layer is the
 * product.
 */
export const GUN_COMPARE_ROWS: CompareRow[] = [...GUN_DERIVED_ROWS, ...GUN_REGISTRY.rows];

/** Group order for the grouped spec table. Anything unlisted falls to the end. */
export const GUN_GROUP_ORDER = [
  DERIVED_GROUP,
  'Identity',
  'Dimensions and mass',
  'Sights and rifling',
  'Operation',
  OTHER_GROUP,
];

export const CARTRIDGE_GROUP_ORDER = ['Identity', 'Dimensions', 'Pressure', OTHER_GROUP];

/** Rows bucketed into groups, in `order`, skipping groups that hold no rows. */
export function groupRows(
  rows: readonly CompareRow[],
  order: readonly string[],
): { group: string; rows: CompareRow[] }[] {
  const buckets = new Map<string, CompareRow[]>();
  for (const row of rows) {
    const bucket = buckets.get(row.group) ?? [];
    bucket.push(row);
    buckets.set(row.group, bucket);
  }
  const ranked = [...buckets.keys()].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
  });
  return ranked.map((group) => ({ group, rows: buckets.get(group)! }));
}
