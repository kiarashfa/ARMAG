/**
 * Smithsonian Open Access — the third image source.
 *
 * 6,000-odd firearm objects with images, most of them from the National Museum
 * of American History, and photographed the way a museum photographs an
 * accession: one object, plain ground, even light, full frame. That is exactly
 * the shot a spec page wants and exactly what Commons runs out of first.
 *
 * ── The licence ───────────────────────────────────────────────────────────
 * Unlike DVIDS, this API states rights per record: `usage.access == "CC0"`.
 * So nothing is asserted here — the flag is read, and a record without it is
 * refused. `media_usage:CC0` is also applied as a search filter, so a
 * non-CC0 record is not offered in the first place; the check on the way out
 * exists because a filter that silently stopped working would otherwise be
 * invisible.
 *
 * CC0 needs no attribution, but the museum and its accession number are
 * recorded anyway: a reader checking a figure against the object wants the
 * catalogue entry, and that is worth more than the licence requires.
 */
import { requireKey } from './env.mjs';
import { getJson, withQuery } from './http.mjs';

const API = 'https://api.si.edu/openaccess/api/v1.0';

const key = () => requireKey('DATA_GOV_API_KEY', 'the Smithsonian Open Access search');

const mediaOf = (row) =>
  (row?.content?.descriptiveNonRepeating?.online_media?.media ?? []).find(
    (item) => item.type === 'Images',
  ) ?? null;

/** The full-size delivery URL for a Smithsonian image id. */
export const deliveryUrl = (idsId, maxPx = 2000) =>
  `https://ids.si.edu/ids/deliveryService?id=${encodeURIComponent(idsId)}&max=${maxPx}`;

/**
 * Search CC0 objects that carry an image.
 *
 * `unit_code` is left open by default: firearms sit in NMAH mostly, but also in
 * the Air and Space and Postal collections, and excluding those by guess would
 * hide records for no reason.
 */
export async function searchObjects(query, { max = 12, unit = null } = {}) {
  const terms = [`(${query})`, 'media_usage:CC0', 'online_media_type:"Images"'];
  if (unit) terms.push(`unit_code:${unit}`);

  const url = withQuery(`${API}/search`, {
    q: terms.join(' AND '),
    rows: String(Math.min(max, 50)),
    api_key: key(),
  });
  const payload = await getJson(url);

  return (payload.response?.rows ?? [])
    .map((row) => {
      const media = mediaOf(row);
      if (!media?.idsId) return null;
      const dnr = row.content?.descriptiveNonRepeating ?? {};
      return {
        id: media.idsId,
        title: row.title ?? '',
        unit: dnr.unit_code ?? '',
        recordId: row.id ?? '',
        recordLink: dnr.record_link ?? dnr.guid ?? '',
        access: media.usage?.access ?? null,
      };
    })
    .filter(Boolean);
}

/**
 * One object by its image id (`NMAH-AHB2015q114865`), as a `SourceMeta`.
 *
 * Looked up through the search index rather than a record endpoint, because the
 * image id is what a person has in front of them after searching and the object
 * id is not printed anywhere they would see.
 */
export async function objectMeta(idsId) {
  const url = withQuery(`${API}/search`, {
    q: `online_media_type:"Images" AND ${idsId}`,
    rows: '10',
    api_key: key(),
  });
  const payload = await getJson(url);

  const row = (payload.response?.rows ?? []).find((candidate) => mediaOf(candidate)?.idsId === idsId);
  if (!row) throw new Error(`no Smithsonian record carries image id ${idsId}`);

  const media = mediaOf(row);
  const access = media.usage?.access ?? null;
  if (access !== 'CC0') {
    throw new Error(
      `${idsId} is marked "${access ?? 'no access statement'}", not CC0. Only the CC0 part of ` +
        'Smithsonian Open Access can be used here; choose another record.',
    );
  }

  const dnr = row.content?.descriptiveNonRepeating ?? {};
  const freetext = row.content?.freetext ?? {};
  const accession = (freetext.identifier ?? [])
    .map((item) => item.content)
    .filter(Boolean)
    .join('; ');

  const pageUrl = dnr.record_link ?? dnr.guid ?? `https://www.si.edu/object/${row.id}`;

  return {
    pageUrl,
    licenseType: 'cc0',
    licenseNote:
      `Smithsonian Open Access, released CC0 by the ${dnr.unit_code ?? 'Smithsonian'}` +
      `${accession ? `. Museum identifier: ${accession}` : ''}.`,
    // CC0 waives attribution; the institution is credited because a museum
    // object's provenance is worth more to a reader than the licence requires.
    author: dnr.unit_code ?? 'Smithsonian Institution',
    title: row.title ?? null,
    description: (freetext.notes ?? []).map((note) => note.content).join(' ') || null,
    downloadUrl: deliveryUrl(idsId),
    originalWidth: null,
    originalHeight: null,
  };
}
