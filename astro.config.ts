// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

/**
 * SPEC.md §6 — while the site lives on the github.io subdomain, `site` is the
 * user domain and `base` is the repository name.
 *
 * `BASE` must match the repository name character for character: GitHub Pages
 * serves a project site at `https://<user>.github.io/<repo>/` and that path is
 * case-sensitive, so a lowercase `/armag` 404s. Repo is `kiarashfa/ARMAG`.
 *
 * Moving to a custom domain later is a two-line change here and nothing else,
 * because every internal link is built through `href()` and every asset URL
 * through `assetUrl()` rather than being hardcoded.
 */
export const SITE = 'https://kiarashfa.github.io';
export const BASE = '/ARMAG';

/**
 * Paths kept out of the sitemap — SPEC.md §12.
 *
 * `/armory/` carries the visitor's own state. It is `noindex` in the document
 * head and it is **not** disallowed in `robots.txt`, which is the whole point:
 * a blocked page is never fetched, so the `noindex` on it is never read, and
 * it can sit in the index as "fetched but not indexed" forever. Excluding it
 * here removes the invitation without removing the instruction.
 *
 * Exported so `check-site.mjs` asserts against this list rather than a second
 * copy that could drift out of step with it.
 */
export const NOINDEX_PATHS = ['/armory/'];

// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: BASE,
  // SPEC.md §6/§12 — canonical URLs always end in a slash.
  trailingSlash: 'always',
  // GitHub Pages cannot run a server; static is the only valid output.
  output: 'static',
  integrations: [
    mdx(),
    svelte(),
    sitemap({
      filter: (page) => !NOINDEX_PATHS.some((path) => new URL(page).pathname === `${BASE}${path}`),
    }),
  ],
  vite: {
    // Tailwind v4 is a Vite plugin, not an Astro integration (SPEC.md §3).
    plugins: [tailwindcss()],
  },
});
