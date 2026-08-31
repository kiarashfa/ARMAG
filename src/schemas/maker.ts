/**
 * The `makers` collection — SPEC.md §5.5.
 *
 * Maker pages are real content (narrative plus identity). The list of models
 * under a maker is **always computed** from `makerRef` on the gun entries and
 * is never hand-maintained here — SPEC.md §2 principle 1, so re-attributing an
 * arm never means editing two files.
 *
 * Two files per entry, joined by `id`:
 *   - `src/content/makers/<slug>.mdx`     → narrative, identity frontmatter only
 *   - `src/content/makerData/<slug>.json` → the structured record
 */
import { z } from 'zod';

import {
  imageRef,
  nativeName,
  slug,
  trustFields,
  wikidataId,
  year,
} from './primitives.ts';
import { countryTag } from './taxonomy.ts';

// ---------------------------------------------------------------------------
// Narrative frontmatter — src/content/makers/<slug>.mdx
// ---------------------------------------------------------------------------

/**
 * Identity essentials only. `.strict()` is deliberate: it makes the two-file
 * discipline self-enforcing, so structured data can never start drifting into
 * the narrative file where nothing validates it.
 */
export const makerNarrativeSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    country: countryTag,
  })
  .strict();
export type MakerNarrative = z.infer<typeof makerNarrativeSchema>;

// ---------------------------------------------------------------------------
// Structured data — src/content/makerData/<slug>.json
// ---------------------------------------------------------------------------

export const makerDataSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    nativeName: nativeName.optional(),
    wikidataId: wikidataId.optional(),

    country: countryTag,
    /**
     * Optional, and the reason is the same one that made a cartridge's
     * `introduced` optional (FRICTION-LOG B2). Sterling Armaments built the
     * British service submachine gun for thirty years and no free source
     * publishes the year the company was founded; the encyclopedia article
     * establishes only that it existed during the Second World War. A mandatory
     * field there offers exactly two options — invent a year, or drop an arm
     * that is otherwise fully sourced — and Instruction.md §0 rule 2 rejects
     * both: a missing figure is an honest gap, and if the schema will not let
     * you record one, the schema is wrong. Found in Phase 10.
     */
    founded: year.optional(),
    dissolved: year.nullable().default(null),

    /** Current corporate owner — a maker id. */
    parentCompany: slug.optional(),
    /**
     * Corporate lineage. Izhmash → Kalashnikov Concern is a rename, not a new
     * company, and an arm made in 1974 was made by the former.
     */
    predecessorOf: slug.optional(),
    successorOf: slug.optional(),

    website: z.url().optional(),
    /**
     * A wordmark is used under trademark nominative-use rather than a
     * copyright licence — `imageCredit` carries that distinction (SPEC.md §10).
     */
    logo: imageRef.optional(),

    ...trustFields,
  })
  .strict()
  .superRefine((maker, ctx) => {
    if (maker.dissolved !== null && maker.founded !== undefined && maker.dissolved < maker.founded) {
      ctx.addIssue({
        code: 'custom',
        path: ['dissolved'],
        message: 'dissolved must not be earlier than founded',
      });
    }
    if (maker.successorOf === maker.id || maker.predecessorOf === maker.id) {
      ctx.addIssue({
        code: 'custom',
        message: 'a maker cannot succeed or precede itself',
      });
    }
  });
export type MakerData = z.infer<typeof makerDataSchema>;
