/**
 * The catalogue row — SPEC.md §9.1.
 *
 * One lean record per entry, built from **the same content the pages render
 * from**, so the catalogue and the page can never give two answers to "what is
 * the barrel length". It is emitted as `/catalogue.json` for the island and
 * rendered directly for the static first rows; both come through here.
 *
 * ── Why a row is wider than SPEC.md's "~12 fields" estimate ────────────────
 * Every axis the reader can filter on has to be *in* the row. Facets show only
 * terms with live matches, with counts (§9.1), and computing those counts from
 * anything but the loaded rows would mean a second fetch and a second source of
 * truth. The row is still lean in the way that matters: no prose, no images, no
 * references, no PropertyValue wrappers — just the bare number and its status.
 *
 * ── Entries below the publication floor are still rows ─────────────────────
 * SPEC.md §5.9 is explicit that a thin entry "exists as a catalogue row and in
 * cartridge/maker listings only". `hasPage` carries that, so the catalogue can
 * list an arm honestly without linking to a page that promises more than it
 * has.
 */
import thresholds from '../../data/thresholds.json' with { type: 'json' };
import { eraForYear } from '../../schemas/taxonomy.ts';
import type { PropertyValue } from '../../schemas/primitives.ts';
import type { ValueStatus } from '../math/provenance.ts';
import { figuresForGun } from './derived.ts';
import { worstStatus } from '../math/provenance.ts';
import {
  completeness,
  countVerified,
  meetsPublicationFloor,
  type CompletenessInput,
  type Tier,
} from '../math/score.ts';
import { proseWordCount } from '../render/prose.ts';
import type { JoinedCartridge, JoinedGun, JoinedMaker } from './entries.ts';

export interface CatalogueRow {
  id: string;
  name: string;
  /** Lowercased name plus every alias, for the island's text filter. */
  search: string;

  // Filterable axes.
  type: string | null;
  action: string | null;
  operatingSystem: string | null;
  feed: string[];
  roles: string[];
  countries: string[];
  era: string | null;

  // Sortable figures. `null` sorts last in both directions, never as zero.
  massKg: number | null;
  barrelMm: number | null;
  capacity: number | null;
  year: number | null;

  /**
   * The three derived figures the matchmaker filters on (SPEC.md §9.3), and the
   * worst status among their inputs.
   *
   * They live in the row rather than in a second artifact because the
   * matchmaker's dealbreakers are *recoil tolerance* and *weight ceiling* —
   * neither is a stored field, and fetching a payload per candidate to answer
   * "which of three thousand arms clear this" would be three thousand fetches.
   * `derivedStatus` travels with them so a result computed from an estimated
   * input can say so rather than presenting a model as a measurement.
   */
  loadedMassKg: number | null;
  freeRecoilJ: number | null;
  derivedStatus: ValueStatus;

  /** Every chambering, not just the primary — the cartridge dealbreaker needs all. */
  cartridgeRefs: string[];

  // Display.
  makerId: string | null;
  makerName: string | null;
  cartridgeId: string | null;
  cartridgeName: string | null;

  tier: Tier;
  /** False for an entry below the publication floor: a row, but no URL. */
  hasPage: boolean;
}

const numberOf = (value: PropertyValue | undefined | null): number | null => value?.value ?? null;

/**
 * The completeness inputs for one entry.
 *
 * Exported because `/methodology/` and the orchestrator's review both want to
 * show the same breakdown, and re-deriving it at either call site is how the
 * two would drift.
 */
export function completenessInputFor(
  gun: JoinedGun,
  makerIds: Set<string>,
  familyIds: Set<string>,
  cartridgeIds: Set<string>,
): CompletenessInput {
  const data = gun.data;

  // The core specs of `score.ts`, read off this entry. Enum fields count as
  // verified when present: a taxonomy tag is validated against a controlled
  // vocabulary at build time, which is a stronger guarantee than a citation.
  const coreStatuses = [
    data.massEmpty?.status,
    data.length?.status,
    data.barrelLength?.status,
    data.chamberings.length > 0 ? ('verified' as const) : undefined,
    data.action ? ('verified' as const) : undefined,
    data.operatingSystem ? ('verified' as const) : undefined,
    data.feedSystem.length > 0 ? ('verified' as const) : undefined,
    data.introduced ? ('verified' as const) : undefined,
  ].filter((status): status is NonNullable<typeof status> => status !== undefined);

  const extendedStatuses = [
    data.width?.status,
    data.height?.status,
    data.lengthFolded?.status,
    data.massMagazineEmpty?.status,
    data.sightRadius?.status,
    data.sightHeightOverBore?.status,
    data.riflingTwist?.status,
    data.cyclicRate?.status,
    data.triggerPull?.status,
    data.effectiveRange?.status,
    data.productionTotal?.status,
  ].filter((status): status is NonNullable<typeof status> => status !== undefined);

  return {
    verifiedCoreSpecs: countVerified(coreStatuses),
    verifiedExtendedSpecs: countVerified(extendedStatuses),
    images: data.images.length,
    proseWords: proseWordCount(gun.narrative.body ?? ''),
    hasResolvedMakerRef: data.makerRef !== null && makerIds.has(data.makerRef),
    hasResolvedFamilyRef: data.familyRef !== null && familyIds.has(data.familyRef),
    resolvedCartridgeRefs: data.chamberings.filter((c) => cartridgeIds.has(c.cartridgeRef)).length,
    variants: data.variants.length,
    lineageEdges: Object.values(data.lineage).filter(Boolean).length,
  };
}

export function buildCatalogue(
  guns: JoinedGun[],
  cartridges: JoinedCartridge[],
  makers: JoinedMaker[],
): CatalogueRow[] {
  const cartridgeData = new Map(cartridges.map((entry) => [entry.id, entry.data]));
  const makerNames = new Map(makers.map((maker) => [maker.id, maker.data.name]));
  const cartridgeNames = new Map(cartridges.map((c) => [c.id, c.data.name]));
  const makerIds = new Set(makerNames.keys());
  const cartridgeIds = new Set(cartridgeNames.keys());
  const familyIds = new Set(guns.filter((gun) => gun.data.kind === 'family').map((gun) => gun.id));

  return guns
    .map((gun) => {
      const data = gun.data;
      const primary = data.chamberings.find((c) => c.primary) ?? data.chamberings[0];
      const input = completenessInputFor(gun, makerIds, familyIds, cartridgeIds);
      const scored = completeness(
        input,
        thresholds.completeness.weights,
        thresholds.completeness.tierFloor,
      );
      // SPEC.md §5.9's floor is written for models: six verified core specs,
      // a maker and a cartridge. A `kind: 'family'` entry has none of the
      // first and cannot have the second, because a platform spans
      // manufacturers (SPEC.md §5.1) and has no mass, length or barrel of its
      // own. Applying it unchanged made the AR-15 an unlinked row saying "no
      // page yet" while its page existed and was linked from its own members.
      // The family floor lives beside the model one in thresholds.json.
      // Found in the Phase 8 pilot batch.
      const floor = meetsPublicationFloor(
        input,
        data.kind === 'family' ? thresholds.familyPublicationFloor : thresholds.publicationFloor,
      );

      // Through the same seam a gun page renders from, so the matchmaker and
      // the entry it links to can never quote two different recoil figures.
      const figures = figuresForGun(
        data,
        primary ? cartridgeData.get(primary.cartridgeRef) : undefined,
      );
      const loaded = figures.byKey['loaded-mass']!;
      const recoil = figures.byKey['free-recoil']!;

      return {
        id: gun.id,
        name: data.name,
        search: [data.name, data.nativeName, ...data.aliases.map((alias) => alias.name)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),

        type: data.type ?? null,
        action: data.action ?? null,
        operatingSystem: data.operatingSystem ?? null,
        feed: data.feedSystem,
        roles: data.roles,
        countries: [...new Set([...(data.designedIn ? [data.designedIn] : []), ...data.producedIn])],
        era: data.introduced ? eraForYear(data.introduced) : null,

        massKg: numberOf(data.massEmpty),
        barrelMm: numberOf(primary?.barrelLength ?? data.barrelLength),
        capacity: numberOf(primary?.capacity),
        year: data.introduced ?? null,

        loadedMassKg: loaded.value,
        freeRecoilJ: recoil.value,
        derivedStatus: worstStatus(loaded.status, recoil.status),

        cartridgeRefs: data.chamberings.map((chambering) => chambering.cartridgeRef),

        makerId: data.makerRef,
        makerName: data.makerRef ? (makerNames.get(data.makerRef) ?? null) : null,
        cartridgeId: primary?.cartridgeRef ?? null,
        cartridgeName: primary ? (cartridgeNames.get(primary.cartridgeRef) ?? null) : null,

        tier: scored.tier,
        hasPage: floor.ok,
      } satisfies CatalogueRow;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** How many rows are server-rendered before the island takes over — SPEC.md §9.1. */
export const STATIC_ROW_COUNT = 50;
