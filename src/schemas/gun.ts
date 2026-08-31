/**
 * The `guns` collection — SPEC.md §5.1, §5.2, §5.3.
 *
 * One flat collection discriminated by `kind`, with two files per entry joined
 * by `id` and never merged:
 *   - `src/content/guns/<slug>.mdx`     → narrative, identity frontmatter only
 *   - `src/content/gunData/<slug>.json` → the full structured spec
 *
 * ── `family` is a grouping, not a parent ───────────────────────────────────
 * The central departure from a conventional model tree, and it exists because
 * firearms break containment in ways cars do not: a platform spans
 * manufacturers (AR-15: Colt, S&W, Ruger, hundreds more), a design is licensed
 * abroad under a new name (AK-47 → Type 56), and a military designation is a
 * second name for a commercial product (SIG P320 = M17). `/guns/ar-15/` is a
 * real page whose model list is *computed* from `familyRef`;
 * `/guns/colt-m4-carbine/` is its own page with its own `makerRef`. Neither
 * owns the other, and re-grouping never breaks a URL.
 *
 * ── The promotion rule, encoded structurally ───────────────────────────────
 * SPEC.md §5.2 promotes a variant to its own entry if it changes receiver size
 * class, primary cartridge family, action, or operating system — so
 * `variantOverrides` below deliberately **does not offer those fields**. A
 * variant that needs to change one of them cannot express it here, which is
 * the schema saying "promote this" at the moment the author reaches for it.
 */
import { z } from 'zod';

import {
  imageRef,
  introducedYear,
  model3d,
  monetaryValue,
  nativeName,
  propertyValue,
  slug,
  trustFields,
  wikidataId,
  yearRange,
} from './primitives.ts';
import {
  actionTag,
  countryTag,
  feedSystemTag,
  fireModeTag,
  operatingSystemTag,
  roleTag,
  typeTag,
} from './taxonomy.ts';

export const gunKind = z.enum(['family', 'model']);
export type GunKind = z.infer<typeof gunKind>;

// ---------------------------------------------------------------------------
// Narrative frontmatter — src/content/guns/<slug>.mdx
// ---------------------------------------------------------------------------

/**
 * Identity essentials only. `.strict()` is deliberate: it makes the two-file
 * discipline self-enforcing, so spec data can never start drifting into the
 * narrative file where nothing validates it.
 */
export const gunNarrativeSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    kind: gunKind,
    /** `null` for a cross-manufacturer family such as the AR-15 platform. */
    makerRef: slug.nullable(),
    /** `null` for an arm that belongs to no family. */
    familyRef: slug.nullable(),
  })
  .strict();
export type GunNarrative = z.infer<typeof gunNarrativeSchema>;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/**
 * An alias — SPEC.md §5.3. Feeds the search index, the "also known as" block,
 * and the alias redirect pages, so "M9" finds the Beretta 92 without minting a
 * duplicate URL.
 */
export const gunAlias = z.object({
  name: z.string().min(1),
  /**
   * `commercial` was added in Phase 10: a maker's own trade designation —
   * Colt Government, Colt Model P — is not a military designation, not an
   * export name and not a nickname, and `cartridgeAlias` already had the
   * term. Without it an author must file a trade name under something
   * false, which is the failure the escalation rule exists to prevent.
   */
  kind: z.enum(['commercial', 'military', 'export', 'importer', 'nickname', 'native']),
  /** Where the alias was used, e.g. 'US', 'DE'. */
  market: z.string().optional(),
  years: yearRange.optional(),
});
export type GunAlias = z.infer<typeof gunAlias>;

/**
 * The lineage graph — SPEC.md §5.3.
 *
 * Renders the family tree and is the single largest source of internal-link
 * density on the site. The four edges are distinct claims and are not
 * interchangeable: `licensedProductionOf` is a legal arrangement, `cloneOf` is
 * the absence of one.
 */
export const lineage = z.object({
  derivedFrom: slug.optional(),
  licensedProductionOf: slug.optional(),
  cloneOf: slug.optional(),
  successorOf: slug.optional(),
});
export type Lineage = z.infer<typeof lineage>;

/**
 * Gun ↔ cartridge is many-to-many — SPEC.md §5.4.
 *
 * `capacity` is dimensionless and lives here rather than on the gun, because a
 * Glock 17 in 9×19 and the same frame in another chambering do not hold the
 * same number of rounds.
 */
export const chambering = z.object({
  cartridgeRef: slug,
  capacity: propertyValue(''),
  /** Barrel length for this chambering, where it differs from the entry's. */
  barrelLength: propertyValue('mm').optional(),
  primary: z.boolean(),
});
export type Chambering = z.infer<typeof chambering>;

/**
 * Accessory compatibility edges — SPEC.md §5.7.
 *
 * The accessories collection is v2; these edges are v1 infrastructure, so that
 * when it lands the compatibility data already exists rather than needing a
 * pass over every entry. Values are pattern names as the industry uses them
 * ('STANAG 4179', 'M-LOK', '1/2×28').
 */
export const fitsEdge = z.object({
  standard: z.enum([
    'magazine-pattern',
    'rail',
    'muzzle-thread',
    'optic-footprint',
    'stock-interface',
  ]),
  value: z.string().min(1),
  note: z.string().optional(),
});
export type FitsEdge = z.infer<typeof fitsEdge>;

/**
 * Every measurable number about one configuration of an arm.
 *
 * All optional, all `PropertyValue`: a missing figure is an honest gap
 * (SPEC.md §2 principle 6) and a present one carries its status and source.
 * This shape is what `variants[].overrides` is a partial of, which is why it is
 * defined once rather than inlined.
 *
 * The last block is reserved for the v2 shooting range (SPEC.md §9.8) and is
 * ballistics-relevant today: `sightHeightOverBore` and `riflingTwist` are
 * inputs the trajectory solver needs, not decoration.
 */
export const gunSpec = z.object({
  massEmpty: propertyValue('kg').optional(),
  /** Needed for loaded mass = empty + magazine + n × cartridge (SPEC.md §8.1). */
  massMagazineEmpty: propertyValue('kg').optional(),

  length: propertyValue('mm').optional(),
  /** Overall length with the stock folded or collapsed, where it folds. */
  lengthFolded: propertyValue('mm').optional(),
  width: propertyValue('mm').optional(),
  height: propertyValue('mm').optional(),
  barrelLength: propertyValue('mm').optional(),

  sightRadius: propertyValue('mm').optional(),
  sightHeightOverBore: propertyValue('mm').optional(),
  /** Twist expressed as one turn in N mm — the form the solver wants. */
  riflingTwist: propertyValue('mm').optional(),
  twistDirection: z.enum(['right', 'left']).optional(),
  riflingGrooves: z.number().int().positive().optional(),

  cyclicRate: propertyValue('rpm').optional(),
  triggerPull: propertyValue('N').optional(),

  /** As stated in a manual. A doctrinal figure, only ever cited, never derived. */
  effectiveRange: propertyValue('m').optional(),
  /** The furthest graduation on the sights, as marked. */
  sightGraduation: propertyValue('m').optional(),
});
export type GunSpec = z.infer<typeof gunSpec>;

/**
 * What a variant or configuration is allowed to change.
 *
 * The spec numbers, plus the three taxonomy fields that genuinely vary within
 * one entry: chambering within the same cartridge family, fire modes, and feed.
 * Action, operating system and type are absent on purpose — changing any of
 * them promotes the variant to its own entry (SPEC.md §5.2).
 */
export const variantOverrides = gunSpec.partial().extend({
  chamberings: z.array(chambering).optional(),
  fireModes: z.array(fireModeTag).optional(),
  feedSystem: z.array(feedSystemTag).optional(),
});
export type VariantOverrides = z.infer<typeof variantOverrides>;

/**
 * A configuration — a row within a variant's spec table.
 *
 * Exists **only where it changes a measurable spec**. Cosmetic SKUs, finishes
 * and commemorative markings are not modelled, and an author who reaches for
 * one here has misread §5.2.
 */
export const gunConfiguration = z.object({
  id: slug,
  name: z.string().min(1),
  overrides: variantOverrides,
});
export type GunConfiguration = z.infer<typeof gunConfiguration>;

export const gunVariant = z
  .object({
    id: slug,
    name: z.string().min(1),
    nativeName: nativeName.optional(),
    productionYears: yearRange.optional(),
    /** One or two sentences on what this variant actually is. */
    summary: z.string().optional(),
    /** ONLY what changed — the delta-override pattern of SPEC.md §5.2. */
    overrides: variantOverrides,
    configurations: z.array(gunConfiguration).default([]),
    /**
     * Set when this variant has outgrown the tab and become its own entry.
     * SPEC.md §5.2: a promoted variant leaves a stub anchor linking to its new
     * home, because promotion must never break an existing in-page link.
     */
    promotedTo: slug.optional(),
  })
  .superRefine((variant, ctx) => {
    const ids = variant.configurations.map((c) => c.id);
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    if (dupes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['configurations'],
        message: `duplicate configuration id(s): ${dupes.join(', ')}`,
      });
    }
  });
export type GunVariant = z.infer<typeof gunVariant>;

// ---------------------------------------------------------------------------
// Structured data — src/content/gunData/<slug>.json
// ---------------------------------------------------------------------------

export const gunDataSchema = gunSpec
  .extend({
    id: slug,
    name: z.string().min(1),
    kind: gunKind,
    nativeName: nativeName.optional(),
    wikidataId: wikidataId.optional(),

    /** `null` for a cross-manufacturer family. */
    makerRef: slug.nullable(),
    /** One primary family. A soft grouping, never ownership. */
    familyRef: slug.nullable(),
    /** Secondary family memberships — a design can belong to more than one. */
    alsoInFamilies: z.array(slug).default([]),

    aliases: z.array(gunAlias).default([]),
    lineage: lineage.default({}),

    /** Absent on a `family` entry, which has no single type. */
    type: typeTag.optional(),
    action: actionTag.optional(),
    fireModes: z.array(fireModeTag).default([]),
    operatingSystem: operatingSystemTag.optional(),
    feedSystem: z.array(feedSystemTag).default([]),
    roles: z.array(roleTag).default([]),

    /** SPEC.md §7 — where it was designed and where it was made differ constantly. */
    designedIn: countryTag.optional(),
    producedIn: z.array(countryTag).default([]),

    /** Era is COMPUTED from this and must never be authored. */
    introduced: introducedYear.optional(),
    productionYears: yearRange.optional(),

    chamberings: z.array(chambering).default([]),
    variants: z.array(gunVariant).default([]),
    fits: z.array(fitsEdge).default([]),

    /** Units produced, where a body such as ATF AFMER or SIPRI publishes it. */
    productionTotal: propertyValue('').optional(),
    /**
     * Launch price as published. SPEC.md §16 rejects a market-value database
     * outright; this is the number `economics.ts` adjusts for inflation, and
     * the condition calculator works from a base the *user* supplies.
     */
    launchPrice: monetaryValue.optional(),

    images: z.array(imageRef).default([]),
    model3d: model3d.optional(),

    ...trustFields,
  })
  .strict()
  .superRefine((gun, ctx) => {
    // A model is a specific arm and must say what kind of arm it is; a family
    // is a platform and must not, because it has no single answer.
    if (gun.kind === 'model') {
      for (const field of ['type', 'action', 'introduced', 'designedIn'] as const) {
        if (gun[field] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `a 'model' entry must record \`${field}\``,
          });
        }
      }
    }

    if (gun.kind === 'family' && gun.familyRef !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['familyRef'],
        message:
          'a family must not belong to another family — `family` is a soft grouping, not a parent, and nesting them makes the computed member list ambiguous (SPEC.md §5.1)',
      });
    }

    if (gun.familyRef === gun.id) {
      ctx.addIssue({ code: 'custom', path: ['familyRef'], message: 'an entry cannot be its own family' });
    }

    for (const [edge, target] of Object.entries(gun.lineage)) {
      if (target === gun.id) {
        ctx.addIssue({
          code: 'custom',
          path: ['lineage', edge],
          message: `lineage.${edge} points at this entry itself`,
        });
      }
    }

    const primaries = gun.chamberings.filter((c) => c.primary);
    if (gun.chamberings.length > 0 && primaries.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['chamberings'],
        message: `exactly one chambering must be marked primary — found ${primaries.length}. The primary chambering is what the hero, the catalogue row and every derived figure default to`,
      });
    }

    const cartridgeRefs = gun.chamberings.map((c) => c.cartridgeRef);
    const dupeCartridges = [...new Set(cartridgeRefs.filter((r, i) => cartridgeRefs.indexOf(r) !== i))];
    if (dupeCartridges.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['chamberings'],
        message: `cartridge '${dupeCartridges[0]}' is listed twice — use one row with the capacity that applies`,
      });
    }

    const variantIds = gun.variants.map((v) => v.id);
    const dupeVariants = [...new Set(variantIds.filter((id, i) => variantIds.indexOf(id) !== i))];
    if (dupeVariants.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['variants'],
        message: `duplicate variant id(s): ${dupeVariants.join(', ')}`,
      });
    }

    if (gun.alsoInFamilies.includes(gun.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['alsoInFamilies'],
        message: 'an entry cannot be its own family',
      });
    }
    if (gun.familyRef && gun.alsoInFamilies.includes(gun.familyRef)) {
      ctx.addIssue({
        code: 'custom',
        path: ['alsoInFamilies'],
        message: `'${gun.familyRef}' is already the primary family — alsoInFamilies is for the secondary ones`,
      });
    }
  });
export type GunData = z.infer<typeof gunDataSchema>;
