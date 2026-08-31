/**
 * Base-path-safe URL construction — SPEC.md §6.
 *
 * The site lives at `/ARMAG/` on github.io today and may live at `/` on a
 * custom domain later. **Every internal link goes through here**, so that
 * migration is a config change and nothing else, and so no link can be written
 * that silently drops the base path and 404s only in production.
 *
 * `assetUrl()` is separate and exists for a second reason: SPEC.md §10
 * pre-plans an escape hatch where images move to a second `gun-assets`
 * repository if the Pages budget is ever approached. With every image URL
 * already going through one helper, that migration is one line rather than
 * 3,000 JSON edits. It is written on day one precisely because it is worthless
 * if it is written on the day it is needed.
 *
 * Reads `import.meta.env.BASE_URL` rather than importing `astro.config.ts`,
 * which would drag the whole integration graph into every page's module graph.
 */

/**
 * `import.meta.env` exists under Vite — in the dev server, in the build, and in
 * the browser — and does NOT exist under bare Node. `node --test` runs these
 * modules directly, so a test that reaches this file through any import chain
 * would throw on module evaluation before a single assertion ran. The fallback
 * is the no-base path, which is what a test that only needs a shape wants; it
 * can never mask a misconfigured build, because a build always runs in Vite.
 */
const BASE = import.meta.env?.BASE_URL ?? '/';

/**
 * Where assets are served from. Change this one line to move images to a
 * second repository or a CDN; nothing else on the site needs to know.
 */
const ASSET_ORIGIN = '';

const trimSlashes = (value: string): string => value.replace(/^\/+/, '').replace(/\/+$/, '');

function join(segments: (string | number)[], trailingSlash: boolean): string {
  const parts = [trimSlashes(BASE), ...segments.map((s) => trimSlashes(String(s)))].filter(
    (s) => s.length > 0,
  );
  const path = `/${parts.join('/')}${trailingSlash ? '/' : ''}`;
  return path.replace(/\/{2,}/g, '/');
}

/**
 * A page URL, always ending in a slash (`trailingSlash: 'always'`).
 *
 *   href()                      → '/ARMAG/'
 *   href('guns', 'glock-17')    → '/ARMAG/guns/glock-17/'
 */
export const href = (...segments: (string | number)[]): string => join(segments, true);

/** A non-page URL — a JSON export, `robots.txt`. No trailing slash: a file is not a directory. */
export const fileHref = (...segments: (string | number)[]): string => join(segments, false);

/**
 * An image or model URL. Remote and data URLs pass through untouched, which is
 * the escape hatch for a source we genuinely cannot mirror.
 */
export function assetUrl(src: string): string {
  if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) return src;
  return ASSET_ORIGIN + fileHref(src);
}

/** Absolute URL, for canonicals, JSON-LD and Open Graph. */
export function absoluteUrl(site: URL | undefined, path: string): string {
  if (!site) return path;
  return new URL(path, site).href;
}

// ---------------------------------------------------------------------------
// The canonical URL of each entity — SPEC.md §6
// ---------------------------------------------------------------------------

export const gunHref = (id: string): string => href('guns', id);
export const rangeHref = (id: string): string => href('guns', id, 'range');
export const cartridgeHref = (id: string): string => href('cartridges', id);
export const makerHref = (id: string): string => href('makers', id);
export const glossaryHref = (id: string): string => href('glossary', id);
export const articleHref = (id: string): string => href('articles', id);

/**
 * Taxonomy URL prefixes, one per axis.
 *
 * Kept here rather than read from the vocabulary files so a template cannot
 * accidentally mint a URL for an axis that has no route. `caliber` is absent on
 * purpose: the cartridge page *is* the caliber view (SPEC.md §5.4).
 */
export const AXIS_PREFIX = {
  type: 'type',
  action: 'action',
  'operating-system': 'operating-system',
  feed: 'feed',
  role: 'role',
  country: 'country',
  era: 'era',
} as const;

export type TaxonomyAxisKey = keyof typeof AXIS_PREFIX;

export const taxonomyHref = (axis: TaxonomyAxisKey, term: string): string =>
  href(AXIS_PREFIX[axis], term);

export const compareHref = (ids: string[]): string =>
  `${href('compare')}${ids.length ? `?guns=${ids.join(',')}` : ''}`;
