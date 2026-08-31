// @ts-check
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

import integrity from './src/integrations/integrity.ts';
import { aliasRedirects } from './src/integrations/alias-redirects.ts';
import rehypeCrosslink from './src/integrations/rehype-crosslink.ts';
import rehypeGlossary from './src/integrations/rehype-glossary.ts';

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

const CONTENT_ROOT = fileURLToPath(new URL('./src/content', import.meta.url));

/**
 * SPEC.md §6 — every alias an entry declares becomes a static redirect to the
 * canonical URL, so a guessed or linked "/guns/m9/" lands somewhere instead of
 * 404ing, and no second page claims to be the entry. See
 * `alias-redirects.ts` for the three rules that decide which aliases qualify.
 */
const ALIAS_REDIRECTS = aliasRedirects(CONTENT_ROOT, BASE);

// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: BASE,
  // SPEC.md §6/§12 — canonical URLs always end in a slash.
  trailingSlash: 'always',
  redirects: ALIAS_REDIRECTS,
  // GitHub Pages cannot run a server; static is the only valid output.
  output: 'static',
  integrations: [
    // `integrity` first: SPEC.md §13 wants the build to stop on bad content
    // before anything else has spent time on it.
    integrity(),
    mdx(),
    svelte(),
    sitemap({
      filter: (page) => !NOINDEX_PATHS.some((path) => new URL(page).pathname === `${BASE}${path}`),
    }),
  ],
  markdown: {
    /**
     * SPEC.md §12 and §5.6 — internal link density with no manual upkeep.
     * Both plugins derive their vocabulary from the content files rather than
     * from anything typed, so the links survive a rename.
     *
     * **Order is load-bearing.** Entry names run first: they are the more
     * specific claim on a piece of text, and once an entry link exists the
     * glossary pass cannot reach inside it, because `a` is a skip tag in the
     * shared walker.
     *
     * Configured through `unified({...})` rather than the top-level
     * `markdown.rehypePlugins`, which Astro 7 deprecates and warns about on
     * every dev-server start. `@astrojs/mdx` extends this config by default,
     * so it is set once here and not twice.
     */
    processor: unified({
      rehypePlugins: [
        [rehypeCrosslink, { contentRoot: CONTENT_ROOT, base: BASE }],
        [rehypeGlossary, { contentRoot: CONTENT_ROOT, base: BASE }],
      ],
    }),
  },
  vite: {
    // Tailwind v4 is a Vite plugin, not an Astro integration (SPEC.md §3).
    plugins: [tailwindcss()],
  },
});
