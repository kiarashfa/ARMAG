/**
 * `/robots.txt` — SPEC.md §12.
 *
 * Written in Phase 7 rather than Phase 11 because Instruction.md Phase 7
 * requires the `/armory/` triple to be **asserted together**, and the third leg
 * of it is a fact about this file. A check that passes because the file it
 * checks does not exist is the green build nobody is testing.
 *
 * ── The one rule this file exists to keep ─────────────────────────────────
 * `NOINDEX_PATHS` are **not** disallowed here. A blocked page is never fetched,
 * so the `noindex` in its head is never read, and it can sit in the index as
 * "fetched but not indexed" indefinitely. Blocking `/armory/` would be the
 * well-meaning move that guarantees the outcome it was meant to prevent, so
 * `check:site` fails the build if any of those paths ever appears in a
 * `Disallow:` line.
 *
 * Nothing else is disallowed either. Everything on ARMAG that is not a
 * visitor's own state is meant to be read.
 */
import type { APIRoute } from 'astro';

import { BASE } from '../../astro.config.ts';

export const GET: APIRoute = ({ site }) => {
  const sitemap = site ? new URL(`${BASE}/sitemap-index.xml`.replace(/\/{2,}/g, '/'), site).href : '';

  const body = [
    '# ARMAG — a free reference for modern firearms.',
    '#',
    '# Nothing is disallowed. /armory/ carries a noindex in its head and is kept',
    '# out of the sitemap; it is deliberately NOT blocked here, because a blocked',
    '# page is never fetched and its noindex is therefore never read.',
    'User-agent: *',
    'Allow: /',
    '',
    ...(sitemap ? [`Sitemap: ${sitemap}`, ''] : []),
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
};
