/**
 * The `cartridges` collection — SPEC.md §5.4.
 *
 * First-class entities, not tags. A cartridge is **the input to every ballistic
 * calculation on the site**, so it is sourced once here rather than re-typed on
 * every gun that chambers it — which is also why a wrong figure in this file is
 * more expensive than a wrong figure anywhere else.
 *
 * The cartridge page is also the caliber taxonomy page: the deliberate
 * exception to "taxonomy pages own no content" (SPEC.md §2 principle 2).
 *
 * ── What is deliberately NOT here ──────────────────────────────────────────
 * There is no powder-charge field, and there never will be. Charge weights are
 * handloading data, and SPEC.md §14 puts fabrication instructions of any kind
 * outside the editorial line. Published velocity per barrel length is a
 * measurement; a charge weight is a recipe.
 */
import { z } from 'zod';

import {
  imageRef,
  introducedYear,
  nativeName,
  propertyValue,
  slug,
  trustFields,
  wikidataId,
  yearRange,
} from './primitives.ts';

/** Head and rim geometry — what a bolt face has to deal with. */
export const caseType = z.enum([
  'rimmed',
  'semi-rimmed',
  'rimless',
  'rebated-rim',
  'belted',
  'shotshell',
]);
export type CaseType = z.infer<typeof caseType>;

/**
 * Body profile. Not in the SPEC.md §5.4 field list; added because bottleneck
 * versus straight-wall is a real, filterable, sourceable fact that readers
 * search on, and because it is one enum rather than a new subsystem.
 */
export const caseShape = z.enum(['straight', 'tapered', 'bottleneck']);
export type CaseShape = z.infer<typeof caseShape>;

/** The body whose dimensions and pressures this entry transcribes. */
export const standardsBody = z.enum(['saami', 'cip', 'nato', 'none']);
export type StandardsBody = z.infer<typeof standardsBody>;

/**
 * A cartridge alias — SPEC.md §9.1.
 *
 * Not in the §5.4 field list, and added deliberately: `.308 Winchester` and
 * `7.62×51mm NATO` are the same cartridge under two names, `9×19mm` answers to
 * four, and "9mm vs .45" is the site's highest-traffic query class. Without
 * aliases in the index, the most-searched terms on the site find nothing.
 */
export const cartridgeAlias = z.object({
  name: z.string().min(1),
  kind: z.enum(['commercial', 'military', 'metric', 'imperial', 'nickname', 'native']),
  note: z.string().optional(),
});
export type CartridgeAlias = z.infer<typeof cartridgeAlias>;

/**
 * One sourced velocity measurement: this load, out of this barrel length.
 *
 * The pair is the whole point of SPEC.md §8.2. A gun's velocity is
 * **interpolated between two sourced points** and rendered labelled as
 * interpolated; extrapolation beyond the sourced range is forbidden, and the
 * "≈25 fps per inch" rule of thumb never appears in this codebase. It is a
 * fabrication with a lab coat on, and a unit test asserts no such constant
 * exists.
 */
export const velocityPoint = z.object({
  barrelLength: propertyValue('mm'),
  velocity: propertyValue('m/s'),
});
export type VelocityPoint = z.infer<typeof velocityPoint>;

export const cartridgeLoad = z
  .object({
    id: slug,
    name: z.string().min(1),
    manufacturer: z.string().optional(),
    bulletMass: propertyValue('g'),
    /** Bullet construction as published, e.g. 'FMJ', 'JHP', 'soft point'. */
    bulletType: z.string().optional(),
    /** Ballistic coefficients. G7 is the honest one for boat-tail rifle bullets. */
    bcG1: propertyValue('').optional(),
    bcG7: propertyValue('').optional(),
    velocityByBarrel: z.array(velocityPoint).default([]),
  })
  .superRefine((load, ctx) => {
    const lengths = load.velocityByBarrel
      .map((p) => p.barrelLength.value)
      .filter((v): v is number => v !== null);
    const duplicates = lengths.filter((v, i) => lengths.indexOf(v) !== i);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['velocityByBarrel'],
        message: `two velocity points share barrel length ${duplicates[0]} mm — interpolation would be ambiguous. Merge them, or record the conflict with status 'conflicting-sources'`,
      });
    }
  });
export type CartridgeLoad = z.infer<typeof cartridgeLoad>;

// ---------------------------------------------------------------------------
// Narrative frontmatter — src/content/cartridges/<slug>.mdx
// ---------------------------------------------------------------------------

export const cartridgeNarrativeSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
  })
  .strict();
export type CartridgeNarrative = z.infer<typeof cartridgeNarrativeSchema>;

// ---------------------------------------------------------------------------
// Structured data — src/content/cartridgeData/<slug>.json
// ---------------------------------------------------------------------------

export const cartridgeDataSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    nativeName: nativeName.optional(),
    wikidataId: wikidataId.optional(),
    aliases: z.array(cartridgeAlias).default([]),

    /** Often a person rather than a company, so free text, not a maker ref. */
    designedBy: z.string().optional(),
    introduced: introducedYear,
    productionYears: yearRange.optional(),

    standard: standardsBody,
    caseType,
    caseShape: caseShape.optional(),

    bulletDiameter: propertyValue('mm'),
    caseLength: propertyValue('mm'),
    overallLength: propertyValue('mm'),
    /** Rim, neck and base diameters, where the datasheet gives them. */
    rimDiameter: propertyValue('mm').optional(),
    neckDiameter: propertyValue('mm').optional(),
    baseDiameter: propertyValue('mm').optional(),

    maxPressure: propertyValue('MPa').optional(),
    /**
     * Which body's pressure figure this is. SAAMI and C.I.P. measure
     * differently and their numbers are not interchangeable, so an unlabelled
     * pressure is worse than none.
     */
    pressureStandard: z.enum(['saami', 'cip', 'nato']).optional(),

    /**
     * Loads are rows, not a collection: they are not independently interesting
     * enough for URLs, and as entities they would multiply into thousands of
     * orphans (SPEC.md §5.4). An identity-only cartridge simply has none.
     */
    loads: z.array(cartridgeLoad).default([]),

    images: z.array(imageRef).default([]),

    ...trustFields,
  })
  .strict()
  .superRefine((cartridge, ctx) => {
    if (cartridge.maxPressure && cartridge.maxPressure.value !== null && !cartridge.pressureStandard) {
      ctx.addIssue({
        code: 'custom',
        path: ['pressureStandard'],
        message:
          'a maximum pressure must say which body measured it — SAAMI and C.I.P. use different methods and their figures are not interchangeable',
      });
    }
    const loadIds = cartridge.loads.map((l) => l.id);
    const dupes = [...new Set(loadIds.filter((id, i) => loadIds.indexOf(id) !== i))];
    if (dupes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['loads'],
        message: `duplicate load id(s): ${dupes.join(', ')}`,
      });
    }
  });
export type CartridgeData = z.infer<typeof cartridgeDataSchema>;
