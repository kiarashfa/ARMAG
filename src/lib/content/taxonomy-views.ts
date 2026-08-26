/**
 * The computed views behind every taxonomy URL — SPEC.md §7.
 *
 * One function per axis would be seven near-identical functions, so the axis is
 * a parameter and the seven route files are three lines each. That matters
 * beyond tidiness: it means a bug in how a browse page is built is one bug, not
 * seven, and it means the tab strip on each page can list its siblings without
 * every route knowing about the vocabulary.
 *
 * **Era is computed from the introduction year and is never authored.** It is
 * handled here alongside the authored axes precisely so no content file is ever
 * tempted to carry an `era` field — the data schemas are strict objects, so one
 * would fail the build anyway (`test-fixtures/.../authored-era.json`).
 */
import type { TaxonomyAxisKey } from './href.ts';
import { getGuns, getMakers, type JoinedGun } from './entries.ts';
import {
  actions,
  countries,
  eraForYear,
  eras,
  feedSystems,
  operatingSystems,
  roles,
  types,
  type VocabTerm,
} from '../../schemas/taxonomy.ts';

export interface AxisDefinition {
  label: string;
  terms: VocabTerm[];
  /** Every term id this entry belongs to on this axis. Multi-valued axes return several. */
  termsOf: (gun: JoinedGun) => string[];
}

export const AXES: Record<TaxonomyAxisKey, AxisDefinition> = {
  type: {
    label: 'Type',
    terms: types.terms,
    termsOf: (gun) => (gun.data.type ? [gun.data.type] : []),
  },
  action: {
    label: 'Action',
    terms: actions.terms,
    termsOf: (gun) => (gun.data.action ? [gun.data.action] : []),
  },
  'operating-system': {
    label: 'Operating system',
    terms: operatingSystems.terms,
    termsOf: (gun) => (gun.data.operatingSystem ? [gun.data.operatingSystem] : []),
  },
  feed: {
    label: 'Feed',
    terms: feedSystems.terms,
    termsOf: (gun) => gun.data.feedSystem,
  },
  role: {
    label: 'Role',
    terms: roles.terms,
    termsOf: (gun) => gun.data.roles,
  },
  country: {
    label: 'Country',
    terms: countries.terms,
    // Designed in AND produced in: SPEC.md §7 keeps them separate fields
    // because they differ constantly, and a reader browsing by country wants
    // both answers on the same page.
    termsOf: (gun) => [
      ...(gun.data.designedIn ? [gun.data.designedIn] : []),
      ...gun.data.producedIn,
    ],
  },
  era: {
    label: 'Era',
    terms: eras.terms,
    termsOf: (gun) => {
      const era = gun.data.introduced ? eraForYear(gun.data.introduced) : null;
      return era ? [era] : [];
    },
  },
};

export interface TaxonomyPathProps {
  params: { term: string };
  props: {
    axis: TaxonomyAxisKey;
    axisLabel: string;
    term: VocabTerm;
    entries: {
      id: string;
      name: string;
      type: string | null;
      makerName: string | null;
      introduced?: number;
    }[];
    siblings: VocabTerm[];
  };
}

/**
 * Every page on one axis.
 *
 * A term with no entries still gets a page. That is deliberate: SPEC.md's
 * sequencing says an axis with no examples is an untested code path, and a
 * browse page that 404s the moment its last entry is re-tagged is worse than an
 * honest empty one.
 */
export async function taxonomyPathsFor(axis: TaxonomyAxisKey): Promise<TaxonomyPathProps[]> {
  const [guns, makers] = await Promise.all([getGuns(), getMakers()]);
  const makerById = new Map(makers.map((maker) => [maker.id, maker.data.name]));
  const definition = AXES[axis];

  return definition.terms.map((term) => ({
    params: { term: term.id },
    props: {
      axis,
      axisLabel: definition.label,
      term,
      siblings: definition.terms,
      entries: guns
        .filter((gun) => definition.termsOf(gun).includes(term.id))
        .map((gun) => ({
          id: gun.id,
          name: gun.data.name,
          type: gun.data.type ?? null,
          makerName: gun.data.makerRef ? (makerById.get(gun.data.makerRef) ?? null) : null,
          introduced: gun.data.introduced,
        })),
    },
  }));
}
