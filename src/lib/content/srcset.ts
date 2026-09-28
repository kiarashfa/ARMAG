/**
 * Responsive image sources.
 *
 * Photographs are stored once, at up to 1600px, because the gallery lightbox
 * shows them full screen. Everywhere else they sit in a slot a few hundred
 * pixels wide, so the build writes an 800px copy beside every photograph wider
 * than `DERIVATIVE_FROM` (`src/integrations/responsive-images.ts`) and pages
 * offer both, letting the browser pick by slot width and pixel density.
 *
 * Pure string work, so an island can use it on a URL it was handed.
 */
export const DERIVATIVE_WIDTH = 800;
export const DERIVATIVE_FROM = 1000;

/** `/x/hero.webp` → `/x/hero.w800.webp`. */
export function derivativeOf(url: string): string {
  return url.replace(/\.webp$/i, `.w${DERIVATIVE_WIDTH}.webp`);
}

/**
 * A `srcset` for a stored photograph, or undefined when it is already small.
 * Also undefined under `astro dev`: the copies are written by the production
 * build, so in dev a `srcset` would point the browser at files that do not
 * exist and the photographs would not load.
 */
export function srcsetFor(url: string | null | undefined, width: number | null | undefined): string | undefined {
  if (import.meta.env?.DEV) return undefined;
  if (!url || !width || width <= DERIVATIVE_FROM || !/\.webp$/i.test(url)) return undefined;
  return `${derivativeOf(url)} ${DERIVATIVE_WIDTH}w, ${url} ${width}w`;
}
