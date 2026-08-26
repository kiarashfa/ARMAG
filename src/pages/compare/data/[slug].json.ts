/**
 * `/compare/data/<slug>.json` — one entry's comparison payload.
 *
 * **One file per entry, not one file for the database.** SPEC.md §9.2 caps a
 * comparison at four entries, so the client never needs more than four of these
 * — and that stays true at three thousand entries, where a single bundle would
 * be megabytes downloaded to compare two arms. The catalogue's own lean bundle
 * (SPEC.md §9.1) answers "what exists"; this answers "everything about these
 * four", and the two are deliberately different shapes.
 *
 * The percentile in each numeric cell is computed here, against the whole
 * database, because the whole database is what a percentile means and the
 * client does not have it. See `lib/compare/entry.ts`.
 */
import type { APIRoute } from 'astro';

import { buildCompareEntry, buildPopulations, type CompareEntry } from '../../../lib/compare/entry.ts';
import { GUN_COMPARE_ROWS } from '../../../lib/compare/rows.ts';
import { buildCatalogue } from '../../../lib/content/catalogue.ts';
import { getCartridges, getGuns, getMakers } from '../../../lib/content/entries.ts';

export async function getStaticPaths() {
  const [guns, cartridges, makers] = await Promise.all([getGuns(), getCartridges(), getMakers()]);

  const cartridgeById = new Map(cartridges.map((entry) => [entry.id, entry]));
  const makerById = new Map(makers.map((entry) => [entry.id, entry]));
  const hasPage = new Map(
    buildCatalogue(guns, cartridges, makers).map((row) => [row.id, row.hasPage]),
  );

  const contextFor = (gun: (typeof guns)[number]) => {
    const primary = gun.data.chamberings.find((c) => c.primary) ?? gun.data.chamberings[0];
    const cartridge = primary ? cartridgeById.get(primary.cartridgeRef)?.data : undefined;
    return {
      cartridge,
      cartridgeName: cartridge?.name ?? null,
      makerName: gun.data.makerRef ? (makerById.get(gun.data.makerRef)?.data.name ?? null) : null,
      hasPage: hasPage.get(gun.id) ?? false,
    };
  };

  // Two passes: the first produces the numbers a percentile is measured
  // against, the second stamps each entry with its position in them. There is
  // no cheaper order — a position cannot be computed before the population is.
  const first = guns.map((gun) => buildCompareEntry(GUN_COMPARE_ROWS, gun.data, contextFor(gun)));
  const populations = buildPopulations(GUN_COMPARE_ROWS, first);

  return guns.map((gun) => ({
    params: { slug: gun.id },
    props: {
      entry: buildCompareEntry(GUN_COMPARE_ROWS, gun.data, { ...contextFor(gun), populations }),
    },
  }));
}

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(props.entry as CompareEntry), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
