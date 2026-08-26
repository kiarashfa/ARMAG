/**
 * Shared schema primitives — SPEC.md §5.8 (data trust and attribution) and §10
 * (imagery licensing).
 *
 * These import `zod` directly rather than `astro:content`'s re-export, so the
 * same schemas can be loaded by plain Node scripts (`scripts/integrity/`) as
 * well as by Astro's content layer. npm dedupes both to the one installed
 * copy, so `defineCollection` gets the instance it expects.
 *
 * The refinements in this file are the site's anti-fabrication mechanism.
 * Instruction.md §0 rule 2 says a missing figure is an honest gap and that "if
 * the schema would let a guess through, the schema is wrong" — so the rules
 * live here, where they fire at the exact field, rather than in a document
 * somebody has to remember.
 */
import { z } from 'zod';

/**
 * Flat, globally-unique, lowercase-kebab slug (SPEC.md §5.1 and §6).
 *
 * Model designations alone are not unique across the industry — `m4`, `p38`
 * and `type-56` each name several unrelated arms — so a slug always carries
 * enough context to stand alone: `colt-m4-carbine`, never `m4`.
 */
export const slug = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'must be lowercase kebab-case: letters, digits and single hyphens only',
  );

/** ISO calendar date, `YYYY-MM-DD`. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date, YYYY-MM-DD');

/**
 * A key into the entry's OWN `references[]` — SPEC.md §13.
 *
 * There is deliberately no site-wide bibliography file. Markey used one and it
 * is a merge-conflict machine the moment more than one author runs at once,
 * with the author who loses the race losing their citations silently. Per-entry
 * bibliographies are what make parallel authoring possible at all, and the
 * standing rule follows from it: an agent touches only files named after its
 * own slug.
 *
 * Resolution is a cross-field concern Zod cannot see from inside one
 * `PropertyValue`, so it is enforced by the integrity checks.
 */
export const citationKey = slug;

/**
 * Any year this site records. The floor is deliberately far below the scope
 * floor of SPEC.md §15 (~1860s), because maker founding dates are not bounded
 * by it: Beretta was founded in 1526.
 */
export const year = z.number().int().min(1500).max(2100);

/** A year at which a firearm or cartridge could actually have been introduced. */
export const introducedYear = z
  .number()
  .int()
  .min(1830, 'earlier than the self-contained metallic cartridge — out of scope (SPEC.md §15)')
  .max(2100);

export const yearRange = z
  .object({
    start: year,
    /** `null` means still in production. */
    end: year.nullable(),
  })
  .refine((r) => r.end === null || r.end >= r.start, {
    message: 'productionYears.end must not be earlier than .start',
  });

/** Wikidata Q-id — the permanent join key of SPEC.md Appendix A. */
export const wikidataId = z
  .string()
  .regex(/^Q[1-9]\d*$/, 'must be a Wikidata Q-id, e.g. Q37116');

/**
 * A name in its original script — SPEC.md §5.1.
 *
 * Deliberately not constrained beyond being non-empty: the whole point is that
 * `Автомат Калашникова` and `九五式自動步槍` are stored as written rather than
 * transliterated into something searchable-but-wrong.
 */
export const nativeName = z.string().min(1);

// ---------------------------------------------------------------------------
// PropertyValue — SPEC.md §5.8
// ---------------------------------------------------------------------------

export const valueStatus = z.enum(['verified', 'estimated', 'placeholder', 'conflicting-sources']);
export type ValueStatus = z.infer<typeof valueStatus>;

/**
 * The SI units this site stores. SPEC.md §2 principle: **SI is what is stored;
 * imperial is always computed on demand, client-side, never stored and never
 * indexed.**
 *
 * An enum rather than a free string is what stops a stray `fps`, `grain` or
 * `ft-lbf` from reaching the database and quietly corrupting the math engine —
 * and `velocity` in fps sitting in a field the solver reads as m/s is exactly
 * the kind of error that produces a plausible wrong answer rather than a
 * crash.
 */
export const siUnit = z.enum([
  'mm', // every length: barrel, case, overall, bullet diameter, sight radius
  'm', // distances at range scale: sight graduations, cited effective range
  'g', // bullet and cartridge mass
  'kg', // firearm mass
  'm/s', // velocity
  'J', // energy
  'N', // trigger pull
  'MPa', // chamber pressure
  'rpm', // cyclic rate
  'mrad', // angular — sights, dispersion
  '', // dimensionless: capacity, ballistic coefficient, twist ratio numerator
]);
export type SiUnit = z.infer<typeof siUnit>;

interface PropertyValueShape {
  value: number | null;
  status: ValueStatus;
  source?: string;
  sourceUrl?: string;
  sourceNote?: string;
}

/**
 * Hedge language that disqualifies a `verified` claim — SPEC.md §13 gate 3.
 *
 * This is the highest-value check on the site. In Markey's own model benchmark
 * four of five models finished a car entry and *all four passed content checks
 * while inventing at least one figure* — and the tell was always the same: a
 * `verified` status with a note quietly admitting the number came from
 * somewhere else. "Verified, same as the 9mm version" is not verification, it
 * is an assumption wearing verification's badge.
 *
 * Enforced here as well as in the integrity walker so it fires in the editor,
 * at the exact field, the moment it is written.
 */
export const HEDGE_WORDS: readonly string[] = [
  'assumed',
  'assume',
  'same as',
  'approx',
  'approximate',
  'typical',
  'similar',
  'probably',
  'presumably',
  'unclear',
  'best guess',
  'estimated from',
  'inferred',
];

/** The hedge words present in a note, lowercased. Empty when it is clean. */
export function hedgeWordsIn(note: string | undefined): string[] {
  if (!note) return [];
  const haystack = note.toLowerCase();
  return HEDGE_WORDS.filter((word) => haystack.includes(word));
}

/**
 * The refinements that encode SPEC.md §5.8, in the order they matter:
 *
 *  - `verified` requires **both** a `source` and a `sourceUrl`. An uncited
 *    number is not verified, and a citation that cannot be clicked cannot be
 *    spot-checked — so the second half is not pedantry, it is what makes
 *    review possible at 3,000 entries.
 *  - `verified` may not hedge. See `HEDGE_WORDS` above.
 *  - `placeholder` requires `value: null`. This is the important one: it makes
 *    it structurally impossible to leave an invented figure sitting behind a
 *    placeholder status.
 *  - `estimated` requires a `sourceNote` stating the basis of the estimate,
 *    because the reader is owed the reasoning, and because the math engine
 *    will propagate that estimate into every derived figure downstream.
 *  - `conflicting-sources` requires both a citation and a note describing the
 *    conflict.
 *  - a null value is only meaningful for `placeholder` / `conflicting-sources`.
 */
function propertyValueRules<T extends z.ZodType<PropertyValueShape>>(schema: T) {
  return schema.superRefine((v, ctx) => {
    if (v.status === 'verified') {
      if (!v.source) {
        ctx.addIssue({
          code: 'custom',
          path: ['source'],
          message: "status 'verified' requires a `source` citation key into this entry's references[]",
        });
      }
      if (!v.sourceUrl) {
        ctx.addIssue({
          code: 'custom',
          path: ['sourceUrl'],
          message:
            "status 'verified' requires a `sourceUrl` — a citation that cannot be clicked cannot be spot-checked (SPEC.md §13 gate 2)",
        });
      }
      const hedges = hedgeWordsIn(v.sourceNote);
      if (hedges.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['sourceNote'],
          message: `status 'verified' with a hedging note (${hedges.join(', ')}) — this is an assumption, not a verified figure. Use 'estimated' and say what it was estimated from (SPEC.md §13 gate 3)`,
        });
      }
    }
    if (v.status === 'placeholder' && v.value !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message:
          "status 'placeholder' requires `value: null` — a placeholder must never carry a plausible-looking invented number (SPEC.md §5.8)",
      });
    }
    if (v.status === 'estimated' && !v.sourceNote) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceNote'],
        message: "status 'estimated' requires a `sourceNote` stating what it was estimated from",
      });
    }
    if (v.status === 'conflicting-sources') {
      if (!v.source) {
        ctx.addIssue({
          code: 'custom',
          path: ['source'],
          message: "status 'conflicting-sources' requires a `source` citation key",
        });
      }
      if (!v.sourceNote) {
        ctx.addIssue({
          code: 'custom',
          path: ['sourceNote'],
          message: "status 'conflicting-sources' requires a `sourceNote` describing the conflict",
        });
      }
    }
    if (v.value === null && v.status !== 'placeholder' && v.status !== 'conflicting-sources') {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: "a null value must be status 'placeholder' or 'conflicting-sources'",
      });
    }
  });
}

const propertyValueBase = {
  value: z.number().nullable(),
  status: valueStatus,
  /** Citation key — resolved against this entry's own `references[]`. */
  source: citationKey.optional(),
  sourceUrl: z.url().optional(),
  /** How this figure was arrived at. Required for anything not plainly cited. */
  sourceNote: z.string().min(1).optional(),
};

/**
 * Builds a `PropertyValue` schema locked to one SI unit.
 *
 * Pinning the unit per field (`propertyValue('m/s')` for velocity) rather than
 * accepting any unit string means a mis-unit is a build failure naming the
 * exact field, not a silently wrong number flowing into `lib/math`.
 */
export function propertyValue<U extends SiUnit>(unit: U) {
  return propertyValueRules(z.object({ ...propertyValueBase, unit: z.literal(unit) }));
}

/** A `PropertyValue` in any SI unit — for generic rendering helpers. */
export const anyPropertyValue = propertyValueRules(
  z.object({ ...propertyValueBase, unit: siUnit }),
);
export type PropertyValue = z.infer<typeof anyPropertyValue>;

/**
 * Money, which is not an SI quantity.
 *
 * A launch price carries a currency, a market and the year it was current, and
 * none of those fit a unit enum — so rather than smuggling `USD` into `siUnit`
 * and corrupting it, price gets its own primitive with the same trust fields.
 * `economics.ts` (SPEC.md §8.1) adjusts it for inflation from the baked CPI
 * table. SPEC.md §16 is explicit that there is no market-value database: this
 * is the launch price as published, and nothing else.
 */
export const monetaryValue = z
  .object({
    amount: z.number().nonnegative().nullable(),
    /** ISO 4217, uppercase. */
    currency: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code, e.g. USD'),
    /** Market the price applied in, e.g. 'US', 'DE'. */
    market: z.string().min(1),
    /** Prices are not comparable across years, so the year is mandatory. */
    year,
    status: valueStatus,
    source: citationKey.optional(),
    sourceUrl: z.url().optional(),
    sourceNote: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'verified' && (!v.source || !v.sourceUrl)) {
      ctx.addIssue({
        code: 'custom',
        message: "status 'verified' requires both a `source` and a `sourceUrl`",
      });
    }
    if (v.status === 'placeholder' && v.amount !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: "status 'placeholder' requires `amount: null`",
      });
    }
  });
export type MonetaryValue = z.infer<typeof monetaryValue>;

// ---------------------------------------------------------------------------
// Imagery — SPEC.md §10
// ---------------------------------------------------------------------------

/**
 * The legal basis on which an image is used, recorded per file so the basis is
 * auditable rather than assumed.
 *
 * `trademark-nominative-use` is deliberately separate from the copyright
 * licences: a maker's wordmark sits on trademark law, not a copyright licence,
 * and the rules that follow are different (use unmodified, for identification
 * only, never implying endorsement).
 */
export const licenseType = z.enum([
  'cc0',
  'public-domain',
  'cc-by',
  'cc-by-sa',
  'cc-by-nc',
  'cc-by-nd',
  'gfdl',
  'manufacturer-press-grant',
  'fair-use-editorial',
  'trademark-nominative-use',
]);
export type LicenseType = z.infer<typeof licenseType>;

/** Licences that require naming the author — SPEC.md §10. */
export const ATTRIBUTION_REQUIRED: ReadonlySet<string> = new Set([
  'cc-by',
  'cc-by-sa',
  'cc-by-nc',
  'cc-by-nd',
  'gfdl',
  'manufacturer-press-grant',
]);

export const imageCredit = z
  .object({
    /** Photographer or uploader as credited by the source. */
    author: z.string().min(1).optional(),
    /** The page the file came from — a Commons file page, not a raw image URL. */
    sourceUrl: z.url(),
    /** Title of the work as published, where the source gives one. */
    title: z.string().optional(),
    licenseType,
    /** e.g. '4.0' for CC BY-SA 4.0. */
    licenseVersion: z.string().optional(),
    licenseUrl: z.url().optional(),
    /** Why this use is defensible. Mandatory for the contestable bases. */
    licenseNote: z.string().min(1).optional(),
  })
  .superRefine((c, ctx) => {
    if (ATTRIBUTION_REQUIRED.has(c.licenseType) && !c.author) {
      ctx.addIssue({
        code: 'custom',
        path: ['author'],
        message: `licenseType '${c.licenseType}' requires attribution — name the author`,
      });
    }
    if (c.licenseType === 'fair-use-editorial' && !c.licenseNote) {
      ctx.addIssue({
        code: 'custom',
        path: ['licenseNote'],
        message:
          'fair-use-editorial requires a `licenseNote` — fair use is a contestable defence, not a licence, and SPEC.md §10 requires it be justified per file',
      });
    }
    if (c.licenseType === 'manufacturer-press-grant' && !c.licenseNote) {
      ctx.addIssue({
        code: 'custom',
        path: ['licenseNote'],
        message:
          'manufacturer-press-grant requires a `licenseNote` pointing at the press terms that grant editorial use',
      });
    }
  });
export type ImageCredit = z.infer<typeof imageCredit>;

export const imageRef = z.object({
  /** Path under `public/`, resolved through `assetUrl()` — never a hotlink. */
  src: z.string().min(1),
  /** Never optional: a spec page is useless to a screen reader without it. */
  alt: z.string().min(1),
  caption: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  credit: imageCredit,
});
export type ImageRef = z.infer<typeof imageRef>;

// ---------------------------------------------------------------------------
// The v2 shooting range — SPEC.md §9.8, reserved in v1
// ---------------------------------------------------------------------------

/**
 * A 3D model for the range at `/guns/<slug>/range/`.
 *
 * Carried now so a Tier 1 entry can be upgraded later without a schema change
 * touching every file. `fidelity` is the honesty field: `representative` means
 * one of the eight generic per-type viewmodels scaled to this entry's real
 * dimensions, and the UI must say so — the same discipline as the silhouette
 * in SPEC.md §9.6.
 */
export const model3d = z.object({
  /** Path under `public/models/`. */
  src: z.string().min(1),
  license: licenseType,
  credit: z.string().min(1),
  fidelity: z.enum(['representative', 'sourced']),
  licenseUrl: z.url().optional(),
  sourceUrl: z.url().optional(),
});
export type Model3d = z.infer<typeof model3d>;

// ---------------------------------------------------------------------------
// Per-entry bibliography — SPEC.md §13
// ---------------------------------------------------------------------------

export const referenceType = z.enum([
  'wikipedia',
  'wikidata',
  'commons',
  'web',
  'book',
  'periodical',
  'dataset',
  'manufacturer-spec',
  'military-manual',
  'standards-body',
  'press-release',
]);
export type ReferenceType = z.infer<typeof referenceType>;

/**
 * One bibliography row, living inside the entry that cites it.
 *
 * The `superRefine` rules exist because three source classes go stale or
 * ambiguous in ways that make an un-annotated citation unverifiable:
 *  - a Wikipedia citation without a revision points at an article that will
 *    have changed by the time anyone checks it;
 *  - a standards-body citation (SAAMI, C.I.P., NATO) without an edition points
 *    at a document that is revised;
 *  - a military manual without its designation cannot be found at all.
 */
export const referenceEntry = z
  .object({
    /** The citation key `PropertyValue.source` points at, unique within the entry. */
    key: citationKey,
    type: referenceType,
    title: z.string().min(1),
    author: z.string().optional(),
    publisher: z.string().optional(),
    url: z.url().optional(),
    year: year.optional(),
    /** When we last read it. A stale citation is a citation worth re-reading. */
    accessed: isoDate.optional(),
    /** Revision id for a wiki source, or edition for a standard or manual. */
    revision: z.string().optional(),
    /** Wikipedia subdomain code — `en` cannot be assumed. */
    lang: z
      .string()
      .regex(/^[a-z]{2,3}(-[a-z]+)?$/, 'a language code like en, de, ru')
      .optional(),
    /** e.g. 'CC BY-SA 4.0', 'public domain'. */
    license: z.string().optional(),
    note: z.string().optional(),
  })
  .superRefine((ref, ctx) => {
    const needsUrl: ReferenceType[] = ['wikipedia', 'wikidata', 'commons', 'web', 'dataset'];
    if (needsUrl.includes(ref.type) && !ref.url) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: `a '${ref.type}' citation must carry the URL it refers to`,
      });
    }
    if (ref.type === 'wikipedia') {
      if (!ref.lang) {
        ctx.addIssue({
          code: 'custom',
          path: ['lang'],
          message: 'a Wikipedia citation must say which language edition it came from',
        });
      }
      if (!ref.revision) {
        ctx.addIssue({
          code: 'custom',
          path: ['revision'],
          message:
            'a Wikipedia citation must name the revision it was read at — the article will have changed by the time anyone verifies it',
        });
      }
      if (!ref.license) {
        ctx.addIssue({
          code: 'custom',
          path: ['license'],
          message: 'a Wikipedia citation must record its licence — CC BY-SA requires attribution',
        });
      }
    }
    if (ref.type === 'standards-body' && !ref.revision) {
      ctx.addIssue({
        code: 'custom',
        path: ['revision'],
        message:
          'a SAAMI / C.I.P. / NATO citation must name the edition or datasheet date — these documents are revised (SPEC.md Appendix A)',
      });
    }
    if (ref.type === 'military-manual' && !ref.revision) {
      ctx.addIssue({
        code: 'custom',
        path: ['revision'],
        message: 'a military manual citation must carry its designation, e.g. TM 9-1005-319-10',
      });
    }
  });
export type ReferenceEntry = z.infer<typeof referenceEntry>;

// ---------------------------------------------------------------------------
// Entry-level trust fields — SPEC.md §5.8
// ---------------------------------------------------------------------------

export const reviewStatus = z.enum(['draft', 'agent-populated', 'spot-checked', 'verified']);
export type ReviewStatus = z.infer<typeof reviewStatus>;

/**
 * Carried by every data file in every collection.
 *
 * `references` is the entry's own bibliography, not a key into a shared file —
 * see `citationKey` above for why that matters more than it looks.
 */
export const trustFields = {
  lastVerified: isoDate,
  reviewStatus,
  references: z.array(referenceEntry).default([]),
};
