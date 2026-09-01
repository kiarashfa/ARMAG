/**
 * DVIDS — the Defense Visual Information Distribution Service.
 *
 * 1.8 million US military photographs, and the second image source on this
 * site. It answers a question Commons usually cannot: **what does this arm look
 * like in service?** Commons is where isolated specimen photographs live —
 * a museum's rifle on a plain ground — and DVIDS is where the same rifle is
 * carried, fired and cleaned. They are complementary, not interchangeable, and
 * a gallery of one specimen shot is thin precisely because only one of the two
 * was ever searched.
 *
 * ── The licence, which is the whole reason this file is careful ────────────
 *
 * The DVIDS API returns **no per-asset rights field**. Nothing in an asset
 * record says "public domain". What it does return is `branch`, and that is the
 * fact the licence actually rests on: a photograph taken by a US service member
 * or Defense Department employee in the course of their duties is a work of the
 * United States Government and is uncopyrighted under 17 U.S.C. §105.
 *
 * So this adapter **asserts** a licence rather than mapping one, and it is only
 * allowed to do that because it first proves the premise:
 *
 *   1. `branch` must be a US armed service. DVIDS also carries allied and
 *      contractor material, and that material is NOT a US Government work.
 *      Anything else is refused by name — never downgraded to "probably fine".
 *   2. The basis travels with the image. `licenseNote` records the statute, the
 *      VIRIN and the unit, so a reader who wants to check the claim has what
 *      they need without coming back here.
 *
 * That is the same shape as `image.mjs logo`: an asserted licence is acceptable
 * only when the reasoning is recorded beside it.
 *
 * A caveat worth knowing before you search: DVIDS matches **caption text**, so
 * a query returns scenes that mention the arm, not photographs of it. Read the
 * description and look at the image before using one — half of what "M3 grease
 * gun" returns is about greasing a tank gun tube.
 */
import { requireKey } from './env.mjs';
import { getJson, withQuery } from './http.mjs';

const API = 'https://api.dvidshub.net';

/**
 * Branches whose imagery is a US Government work.
 *
 * A closed list, checked case-insensitively. DVIDS labels partner-nation and
 * contractor material with other branch values, and those are the records this
 * gate exists to keep out.
 */
const US_BRANCHES = new Set([
  'army',
  'navy',
  'marines',
  'marine corps',
  'air force',
  'coast guard',
  'space force',
  'joint',
  'national guard',
  'dod',
]);

const key = () => requireKey('DVIDS_API_KEY', 'the DVIDS image search');

/** `image:6219032` → the id DVIDS wants; accepts a bare number too. */
export const asAssetId = (raw) => (/^image:/.test(raw) ? raw : `image:${String(raw).replace(/\D/g, '')}`);

/**
 * Search photographs. Returns lean rows — enough to choose from, not enough to
 * credit with; `assetMeta` is what produces a usable record.
 */
export async function searchImages(query, { max = 12 } = {}) {
  const url = withQuery(`${API}/search`, {
    q: query,
    type: 'image',
    max_results: String(Math.min(max, 50)),
    api_key: key(),
  });
  const payload = await getJson(url);
  return (payload.results ?? []).map((row) => ({
    id: row.id,
    title: row.title ?? '',
    branch: row.branch ?? '',
    unit: row.unit_name ?? '',
    date: (row.date_published ?? row.date ?? '').slice(0, 10),
    description: row.short_description ?? '',
    keywords: row.keywords ?? '',
    width: row.width ?? null,
    height: row.height ?? null,
    url: row.url ?? '',
  }));
}

/**
 * One asset, as the `SourceMeta` shape `buildImageRef` consumes.
 *
 * Throws rather than returning a partial record when the branch is not a US
 * service, for the reason in the module header.
 */
export async function assetMeta(rawId) {
  const id = asAssetId(rawId);
  const url = withQuery(`${API}/asset`, { id, api_key: key() });
  const payload = await getJson(url);
  const asset = payload.results;
  if (!asset || !asset.id) throw new Error(`DVIDS has no asset ${id}`);

  const branch = (asset.branch ?? '').trim();
  if (!US_BRANCHES.has(branch.toLowerCase())) {
    throw new Error(
      `${id} is credited to branch "${branch || '(none stated)'}", which is not a US armed service. ` +
        'DVIDS also hosts allied and contractor imagery, and that is not a US Government work — ' +
        'its copyright status is unknown, so it cannot be used here. Choose another asset.',
    );
  }

  const photographer = (asset.credit ?? [])
    .map((person) => [person.rank, person.name].filter(Boolean).join(' ').trim())
    .filter(Boolean)
    .join(', ');

  const virin = asset.virin ?? null;
  const unit = asset.unit_name ?? null;

  return {
    pageUrl: asset.url,
    // Asserted, not mapped. The premise is proved above; the basis is recorded
    // in the note so the claim is checkable from the page itself.
    licenseType: 'public-domain',
    licenseNote:
      'Work of the United States Government, uncopyrighted under 17 U.S.C. §105: ' +
      `photographed for the ${branch}${unit ? ` (${unit})` : ''}` +
      `${virin ? `, VIRIN ${virin}` : ''}. DVIDS states no separate licence per asset.`,
    author: photographer || null,
    title: asset.title ?? null,
    description: asset.description ?? null,
    // Not part of the credit — the caller needs them to fetch and measure.
    downloadUrl: asset.image ?? null,
    originalWidth: asset.dimensions?.width ?? null,
    originalHeight: asset.dimensions?.height ?? null,
    keywords: asset.keywords ?? '',
    branch,
    virin,
  };
}
