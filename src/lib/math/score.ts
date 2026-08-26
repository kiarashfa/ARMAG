/**
 * Completeness and tier — SPEC.md §5.9.
 *
 * **Tier is computed, never asserted by an author.** That single decision is
 * what makes the anti-fabrication rules bite: the score counts only `verified`
 * values, so an entry full of estimates scores the same as an entry full of
 * blanks, and inventing figures cannot raise a page's tier. Estimating your way
 * to a full spec sheet produces a Tier 3 entry covered in amber badges, which
 * is precisely the outcome that makes it not worth doing.
 *
 * The formula is public on `/methodology/`, and the weights live in
 * `src/data/thresholds.json` so tuning them after the pilot batch is a
 * one-line change with no code to edit.
 *
 * Pure. No DOM, no I/O, no framework import.
 */
import type { ValueStatus } from './provenance.ts';

export interface CompletenessWeights {
  verifiedCoreSpec: number;
  verifiedExtendedSpec: number;
  image: number;
  proseWordsPer100: number;
  resolvedMakerRef: number;
  resolvedFamilyRef: number;
  resolvedCartridgeRef: number;
  variant: number;
  lineageEdge: number;
}

export interface TierFloor {
  tier1: number;
  tier2: number;
}

/**
 * What the score is computed from — counts, not content.
 *
 * Deliberately a flat shape rather than the gun schema: it keeps `lib/math`
 * free of any dependency on the content model, and it makes the scoring
 * testable without constructing a whole entry.
 */
export interface CompletenessInput {
  verifiedCoreSpecs: number;
  verifiedExtendedSpecs: number;
  images: number;
  proseWords: number;
  hasResolvedMakerRef: boolean;
  hasResolvedFamilyRef: boolean;
  resolvedCartridgeRefs: number;
  variants: number;
  lineageEdges: number;
}

export type Tier = 1 | 2 | 3;

export interface CompletenessResult {
  score: number;
  tier: Tier;
  /** Every contribution, in the order it is shown on `/methodology/`. */
  breakdown: { label: string; count: number; weight: number; points: number }[];
}

/**
 * The core specs — the figures without which a page is not really about a
 * specific arm. Named here rather than counted at the call site so the
 * methodology page and the score cannot disagree about what "core" means.
 */
export const CORE_SPEC_FIELDS = [
  'massEmpty',
  'length',
  'barrelLength',
  'chamberings',
  'action',
  'operatingSystem',
  'feedSystem',
  'introduced',
] as const;

export function completeness(
  input: CompletenessInput,
  weights: CompletenessWeights,
  floor: TierFloor,
): CompletenessResult {
  const breakdown = [
    { label: 'Verified core specifications', count: input.verifiedCoreSpecs, weight: weights.verifiedCoreSpec },
    { label: 'Verified further specifications', count: input.verifiedExtendedSpecs, weight: weights.verifiedExtendedSpec },
    { label: 'Licensed images', count: input.images, weight: weights.image },
    { label: 'Original prose (per 100 words)', count: input.proseWords / 100, weight: weights.proseWordsPer100 },
    { label: 'Maker resolves', count: input.hasResolvedMakerRef ? 1 : 0, weight: weights.resolvedMakerRef },
    { label: 'Family resolves', count: input.hasResolvedFamilyRef ? 1 : 0, weight: weights.resolvedFamilyRef },
    { label: 'Cartridges resolve', count: input.resolvedCartridgeRefs, weight: weights.resolvedCartridgeRef },
    { label: 'Variants documented', count: input.variants, weight: weights.variant },
    { label: 'Lineage edges', count: input.lineageEdges, weight: weights.lineageEdge },
  ].map((row) => ({ ...row, points: row.count * row.weight }));

  const score = breakdown.reduce((total, row) => total + row.points, 0);
  const tier: Tier = score >= floor.tier1 ? 1 : score >= floor.tier2 ? 2 : 3;

  return { score: Math.round(score * 10) / 10, tier, breakdown };
}

/**
 * Counts a set of values toward the score.
 *
 * The whole anti-fabrication mechanism is this one line: anything that is not
 * `verified` contributes nothing. Not less — nothing.
 */
export const countVerified = (statuses: readonly ValueStatus[]): number =>
  statuses.filter((status) => status === 'verified').length;

export interface PublicationFloor {
  verifiedCoreSpecs: number;
  images: number;
  proseWords: number;
  requiresResolvingMakerRef: boolean;
  requiresResolvingCartridgeRef: boolean;
}

/**
 * Whether an entry has enough substance to own a page — SPEC.md §5.9.
 *
 * Below the floor it is not deleted and it is not hidden: it stays a catalogue
 * row and appears in cartridge and maker listings. It just does not get a URL
 * that promises more than it has.
 *
 * Returns the reasons, not a bare boolean, so the orchestrator reviewing agent
 * output is told what is missing rather than that something is.
 */
export function meetsPublicationFloor(
  input: CompletenessInput,
  floor: PublicationFloor,
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];

  if (input.verifiedCoreSpecs < floor.verifiedCoreSpecs) {
    missing.push(
      `${input.verifiedCoreSpecs} verified core specs, needs ${floor.verifiedCoreSpecs}`,
    );
  }
  if (input.images < floor.images) {
    missing.push(`${input.images} licensed image(s), needs ${floor.images}`);
  }
  if (input.proseWords < floor.proseWords) {
    missing.push(`${input.proseWords} words of prose, needs ${floor.proseWords}`);
  }
  if (floor.requiresResolvingMakerRef && !input.hasResolvedMakerRef) {
    missing.push('no resolving maker');
  }
  if (floor.requiresResolvingCartridgeRef && input.resolvedCartridgeRefs === 0) {
    missing.push('no resolving cartridge');
  }

  return { ok: missing.length === 0, missing };
}
