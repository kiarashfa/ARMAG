/**
 * Controlled vocabularies — SPEC.md §7.
 *
 * The JSON files under `src/data/taxonomy/` are the single source of truth. The
 * Zod enums are built *from* them at load time rather than restated here, so
 * adding a term is a one-file change, and an invalid tag fails the build naming
 * the file to fix instead of silently creating an orphan taxonomy page.
 *
 * Seven authored axes plus two computed ones. **Era is computed** from the
 * introduction year and must never be authored. **Caliber is not an axis at
 * all** — the cartridge page *is* the caliber view (SPEC.md §5.4), which is the
 * one deliberate exception to "taxonomy pages own no content".
 *
 * The split between `action` and `fireModes` is the one to protect: conflating
 * how the breech cycles with what the trigger does is the most common error in
 * firearm databases, and it makes correct filtering impossible.
 */
import { z } from 'zod';

import typesVocab from '../data/taxonomy/types.json' with { type: 'json' };
import actionsVocab from '../data/taxonomy/actions.json' with { type: 'json' };
import fireModesVocab from '../data/taxonomy/fire-modes.json' with { type: 'json' };
import operatingSystemsVocab from '../data/taxonomy/operating-systems.json' with { type: 'json' };
import feedSystemsVocab from '../data/taxonomy/feed-systems.json' with { type: 'json' };
import rolesVocab from '../data/taxonomy/roles.json' with { type: 'json' };
import countriesVocab from '../data/taxonomy/countries.json' with { type: 'json' };
import erasVocab from '../data/taxonomy/eras.json' with { type: 'json' };

export interface VocabTerm {
  id: string;
  label: string;
  description?: string;
  aka?: string[];
}

export interface Vocabulary {
  axis: string;
  urlPrefix: string;
  authored: boolean;
  note?: string;
  terms: VocabTerm[];
}

/** A type term also names the content accent it renders in (SPEC.md §11). */
export interface TypeTerm extends VocabTerm {
  accent: 'handgun' | 'rifle' | 'shotgun' | 'smg' | 'machinegun' | 'platform';
}

/** A country term may be a historical state with an end date and a successor. */
export interface CountryTerm extends VocabTerm {
  existed?: { start: number; end: number };
  succeededBy?: string;
}

/** Era buckets carry their own boundaries, since era is derived, not authored. */
export interface EraTerm extends VocabTerm {
  start: number;
  end: number;
}

/**
 * The three vocabularies whose terms carry extra fields get their own
 * interface rather than a `Vocabulary & { terms: X[] }` intersection: TypeScript
 * resolves the intersected `terms` to the base element type and the extra
 * fields silently vanish.
 */
export interface TypeVocabulary extends Omit<Vocabulary, 'terms'> {
  terms: TypeTerm[];
}
export interface CountryVocabulary extends Omit<Vocabulary, 'terms'> {
  terms: CountryTerm[];
}
export interface EraVocabulary extends Omit<Vocabulary, 'terms'> {
  terms: EraTerm[];
}

/** The browse axes of SPEC.md §6, in the order they appear in the URL table. */
export const TAXONOMY_AXES = [
  'type',
  'action',
  'operating-system',
  'feed',
  'role',
  'country',
  'era',
] as const;
export type TaxonomyAxis = (typeof TAXONOMY_AXES)[number];

function ids(vocab: { terms: readonly { id: string }[] }): [string, ...string[]] {
  const list = vocab.terms.map((t) => t.id);
  if (list.length === 0) {
    throw new Error('taxonomy vocabulary is empty — every axis needs at least one term');
  }
  const duplicates = list.filter((id, i) => list.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw new Error(`duplicate taxonomy term id(s): ${[...new Set(duplicates)].join(', ')}`);
  }
  return list as [string, ...string[]];
}

export const types = typesVocab as unknown as TypeVocabulary;
export const actions = actionsVocab as Vocabulary;
export const fireModes = fireModesVocab as Vocabulary;
export const operatingSystems = operatingSystemsVocab as Vocabulary;
export const feedSystems = feedSystemsVocab as Vocabulary;
export const roles = rolesVocab as Vocabulary;
export const countries = countriesVocab as unknown as CountryVocabulary;
export const eras = erasVocab as unknown as EraVocabulary;

export const typeTag = z.enum(ids(types));
export const actionTag = z.enum(ids(actions));
export const fireModeTag = z.enum(ids(fireModes));
export const operatingSystemTag = z.enum(ids(operatingSystems));
export const feedSystemTag = z.enum(ids(feedSystems));
export const roleTag = z.enum(ids(roles));
export const countryTag = z.enum(ids(countries));

export type TypeTag = z.infer<typeof typeTag>;
export type ActionTag = z.infer<typeof actionTag>;
export type FireModeTag = z.infer<typeof fireModeTag>;
export type OperatingSystemTag = z.infer<typeof operatingSystemTag>;
export type FeedSystemTag = z.infer<typeof feedSystemTag>;
export type RoleTag = z.infer<typeof roleTag>;
export type CountryTag = z.infer<typeof countryTag>;

/** Every authored vocabulary, keyed by axis — used to build taxonomy pages. */
export const AUTHORED_VOCABULARIES: Record<string, Vocabulary> = {
  type: types,
  action: actions,
  'fire-mode': fireModes,
  'operating-system': operatingSystems,
  feed: feedSystems,
  role: roles,
  country: countries,
};

export function termsOf(axis: string): VocabTerm[] {
  return AUTHORED_VOCABULARIES[axis]?.terms ?? [];
}

export function labelFor(axis: string, id: string): string | undefined {
  return termsOf(axis).find((t) => t.id === id)?.label;
}

/**
 * The content accent a firearm type renders in — SPEC.md §11.
 *
 * Six accents cover eight types. A `kind: 'family'` entry has no single type
 * and uses `platform`, which is why that is the fallback rather than an error.
 */
export function accentForType(type: string | null | undefined): TypeTerm['accent'] {
  if (!type) return 'platform';
  return types.terms.find((t) => t.id === type)?.accent ?? 'platform';
}

// ---------------------------------------------------------------------------
// Era — computed, never authored (SPEC.md §7)
// ---------------------------------------------------------------------------

/**
 * The era bucket an introduction year falls in.
 *
 * One bucket, not a range: SPEC.md §7 says era is computed *from the
 * introduction year*, and an arm produced from 1959 to the present belongs to
 * the early Cold War that produced it, not to every decade it outlived.
 */
export function eraForYear(introduced: number): string | null {
  return eras.terms.find((era) => introduced >= era.start && introduced <= era.end)?.id ?? null;
}
