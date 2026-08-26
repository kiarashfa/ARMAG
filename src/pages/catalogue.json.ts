/**
 * `/catalogue.json` — the build artifact behind the catalogue island.
 *
 * Generated from the same content the pages render from (SPEC.md §9.1), so the
 * catalogue and a gun page cannot give two answers to the same question.
 *
 * The payload is a versioned envelope rather than a bare array. That costs
 * nothing today and buys the one thing the loader will need later: SPEC.md §9.1
 * requires this be chunkable "without touching callers", and a caller that
 * destructures `{ rows }` keeps working when a `chunks` field appears beside it,
 * where a caller that indexes an array does not.
 */
import type { APIRoute } from 'astro';

import { buildCatalogue } from '../lib/content/catalogue.ts';
import { getCartridges, getGuns, getMakers } from '../lib/content/entries.ts';

export const GET: APIRoute = async () => {
  const [guns, cartridges, makers] = await Promise.all([getGuns(), getCartridges(), getMakers()]);
  const rows = buildCatalogue(guns, cartridges, makers);

  return new Response(
    JSON.stringify({
      version: 1,
      generated: rows.length,
      rows,
    }),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // A build artifact served from a static host: it changes only when the
        // site is rebuilt, and the filename does not hash, so revalidation has
        // to be the browser's job rather than a long immutable cache.
        'Cache-Control': 'public, max-age=0, must-revalidate',
      },
    },
  );
};
