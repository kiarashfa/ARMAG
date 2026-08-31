/**
 * The licence gate: nothing becomes an `imageRef` without provable licence data.
 *
 * Instruction.md Phase 9 states the definition of done for this file directly —
 * **`image.mjs` cannot emit an `imageRef` missing licence data** — so the rule
 * is encoded structurally rather than documented:
 *
 *  1. `licenseTypeFor()` returns `null` for a licence string it does not
 *     recognise, and the builder throws on `null`. It never falls back to a
 *     "close enough" enum member. The Phase 8 friction log (D2) is the reason:
 *     UK `OGL v1.0` and French `Licence Ouverte` are both attribution licences
 *     that *look* like CC BY, and mapping them to `cc-by` would put a licence
 *     name on the page that the file is not actually under.
 *  2. Every ref is parsed through the **real** `imageRef` schema from
 *     `src/schemas/primitives.ts` before it can be printed. Not a copy of it —
 *     the same object the content collection validates with, so the fetcher and
 *     the build cannot drift. `ATTRIBUTION_REQUIRED` without an author already
 *     fails there; this file adds nothing on top and deliberately reimplements
 *     nothing.
 *  3. `alt` and `caption` are emitted as `TODO` markers, never as the source's
 *     own description. An `alt` copied from `ImageDescription` reads as a
 *     description of the *file*, not of what a reader who cannot see it needs,
 *     and Phase 8 (friction D5) found two of thirty-four Commons descriptions
 *     were about a different variant than the photograph showed.
 *
 * Pure — no network, no disk. Held to tests in `imageref.test.ts`.
 */
import { imageRef } from '../../../src/schemas/primitives.ts';

/**
 * Commons' `LicenseShortName` mapped onto the schema's `licenseType` enum.
 *
 * Order matters: `cc by-sa` must be tested before `cc by`, or every share-alike
 * file is recorded as plain CC BY and the share-alike obligation vanishes.
 */
export function licenseTypeFor(shortName) {
  const name = (shortName ?? '').toLowerCase();
  if (!name) return null;
  if (name.includes('cc0') || name.includes('zero')) return 'cc0';
  if (name.includes('cc by-sa') || name.includes('cc-by-sa')) return 'cc-by-sa';
  if (name.includes('cc by-nd') || name.includes('cc-by-nd')) return 'cc-by-nd';
  if (name.includes('cc by-nc') || name.includes('cc-by-nc')) return 'cc-by-nc';
  if (name.includes('cc by') || name.includes('cc-by')) return 'cc-by';
  if (name.includes('gfdl')) return 'gfdl';
  if (name.includes('public domain') || name.startsWith('pd') || name.includes('pd-')) {
    return 'public-domain';
  }
  return null;
}

/**
 * Licences seen on good firearm photography that the enum has no member for.
 *
 * Named individually so the failure message can say *which* licence and what
 * the open decision about it is, rather than "unknown licence" — an author who
 * is told the name can escalate it (Instruction.md §5) instead of guessing.
 */
const KNOWN_UNMAPPED = {
  'ogl v1.0': 'UK Open Government Licence',
  'ogl 3.0': 'UK Open Government Licence',
  'open government licence': 'UK Open Government Licence',
  'licence ouverte': 'French Licence Ouverte / Open Licence',
  'etalab': 'French Licence Ouverte / Open Licence',
};

/** The licence version, where the short name carries one: 'CC BY-SA 4.0' → '4.0'. */
export function licenseVersionFrom(shortName) {
  const match = /(\d+\.\d+)/.exec(shortName ?? '');
  return match ? match[1] : undefined;
}

/**
 * What a source adapter hands over. Commons fills all of it; a future DVIDS or
 * Smithsonian adapter fills the same shape, which is why this is a type and not
 * a Commons-specific signature.
 *
 * @typedef {object} SourceMeta
 * @property {string} pageUrl        the file's page, never a raw image URL
 * @property {string|null} [licenseShortName]
 * @property {string|null} [licenseUrl]
 * @property {string|null} [author]
 * @property {string|null} [title]
 * @property {string|null} [description]
 * @property {string|null} [licenseNote]
 * @property {string|null} [licenseType] already mapped, when the adapter knows it
 */

/**
 * Builds and validates one `imageRef`. Throws — never returns partial — when
 * the licence cannot be established.
 *
 * @param {object} input
 * @param {string} input.src
 * @param {number} [input.width]
 * @param {number} [input.height]
 * @param {SourceMeta|null} input.meta
 * @param {string} [input.alt]
 * @param {string} [input.caption]
 */
export function buildImageRef({ src, width, height, meta, alt, caption }) {
  if (!meta) throw new Error('no source metadata — refusing to emit an imageRef without a licence');
  if (!meta.pageUrl) {
    throw new Error(
      'no source page URL — SPEC.md §10 requires the file page an image came from, not a raw image URL',
    );
  }

  const licenseType = meta.licenseType ?? licenseTypeFor(meta.licenseShortName);
  if (!licenseType) {
    const short = (meta.licenseShortName ?? '').toLowerCase();
    const known = Object.entries(KNOWN_UNMAPPED).find(([key]) => short.includes(key));
    if (known) {
      throw new Error(
        `licence "${meta.licenseShortName}" is ${known[1]}, which has no member in the licenseType enum. ` +
          'Do NOT map it to cc-by — it is a different licence. Escalate (FRICTION-LOG D2 proposes adding it) or choose another file.',
      );
    }
    throw new Error(
      `licence "${meta.licenseShortName ?? '(none reported)'}" is not in the licenseType enum — resolve by hand, never approximate.`,
    );
  }

  const candidate = {
    src,
    alt: alt ?? 'TODO — describe what is visible, for a reader who cannot see it',
    caption: caption ?? 'TODO — say what this photograph actually shows, including the variant',
    ...(Number.isInteger(width) && Number.isInteger(height) ? { width, height } : {}),
    credit: {
      ...(meta.author ? { author: meta.author } : {}),
      sourceUrl: meta.pageUrl,
      ...(meta.title ? { title: meta.title } : {}),
      licenseType,
      ...(licenseVersionFrom(meta.licenseShortName)
        ? { licenseVersion: licenseVersionFrom(meta.licenseShortName) }
        : {}),
      ...(meta.licenseUrl ? { licenseUrl: meta.licenseUrl } : {}),
      ...(meta.licenseNote ? { licenseNote: meta.licenseNote } : {}),
    },
  };

  // The same schema `check:content` uses. If this throws, the entry would have
  // failed the build anyway — failing here just means it fails before the
  // author has written a page around it.
  const parsed = imageRef.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`this file cannot produce a valid imageRef:\n${issues}`);
  }
  return parsed.data;
}
