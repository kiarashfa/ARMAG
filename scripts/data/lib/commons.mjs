/**
 * Wikimedia Commons access — file discovery and machine-readable licence.
 *
 * SPEC.md §10 names `extmetadata` as the thing that makes automated credit
 * capture possible, and the Phase 8 friction log (D1) confirmed it: one
 * `prop=imageinfo&iiprop=url|size|extmetadata` call returns licence short name,
 * author, licence URL and description, and 25 titles batch per request. All 34
 * pilot images were captured with zero manual licence lookups.
 *
 * Everything here returns data. Nothing here decides whether a file may be
 * used — that is `imageref.mjs`, so the licence gate has exactly one door.
 */
import { getJson, withQuery } from './http.mjs';

const EN = 'https://en.wikipedia.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const WIKIDATA = 'https://www.wikidata.org/w/api.php';

const stripHtml = (html) =>
  (html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Commons titles carry the `File:` namespace, and a title without it resolves
 * to nothing — which the API reports identically to a file that genuinely does
 * not exist. Normalise rather than report: the namespace is a syntax detail.
 */
export const asFileTitle = (title) =>
  /^file:/i.test(String(title).trim()) ? String(title).trim() : `File:${String(title).trim()}`;

/** The images an article actually uses — curated, and variant-correct. */
export async function articleImages(title) {
  const data = await getJson(
    withQuery(EN, {
      action: 'query',
      prop: 'images',
      titles: title,
      imlimit: '500',
      redirects: '1',
      format: 'json',
      formatversion: '2',
    }),
  );
  const page = data.query?.pages?.[0];
  return (page?.images ?? [])
    .map((i) => i.title)
    .filter((t) => /\.(jpe?g|png|webp)$/i.test(t))
    // Wikipedia decorates every article with the same handful of icons.
    .filter((t) => !/(commons-logo|wiktionary|edit-ltr|question_book|ambox|flag of)/i.test(t));
}

export async function wikidataIdFor(title) {
  const data = await getJson(
    withQuery(EN, {
      action: 'query',
      prop: 'pageprops',
      titles: title,
      redirects: '1',
      format: 'json',
      formatversion: '2',
    }),
  );
  return data.query?.pages?.[0]?.pageprops?.wikibase_item ?? null;
}

/** The Commons category an item points at (P373). */
export async function commonsCategory(qid) {
  if (!qid) return null;
  const data = await getJson(
    withQuery(WIKIDATA, { action: 'wbgetclaims', entity: qid, property: 'P373', format: 'json' }),
  );
  return data.claims?.P373?.[0]?.mainsnak?.datavalue?.value ?? null;
}

/**
 * Members of a Commons category.
 *
 * Category listings do not recurse, and for arms the photographs are very often
 * one level down — `Category:AK-47` holds subcategories per variant and per
 * museum, with few files directly. `type` is `file` or `subcat`.
 */
export async function categoryMembers(category, type = 'file') {
  const data = await getJson(
    withQuery(COMMONS, {
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${category.replace(/^Category:/i, '')}`,
      cmtype: type,
      cmlimit: '200',
      format: 'json',
      formatversion: '2',
    }),
  );
  return (data.query?.categorymembers ?? []).map((m) => m.title);
}

/** Full-text file search on Commons, for when an article carries no usable photograph. */
export async function searchFiles(query, limit = 25) {
  const data = await getJson(
    withQuery(COMMONS, {
      action: 'query',
      list: 'search',
      srsearch: `${query} filetype:bitmap`,
      srnamespace: '6',
      srlimit: String(limit),
      format: 'json',
      formatversion: '2',
    }),
  );
  return (data.query?.search ?? []).map((r) => r.title);
}

/**
 * Licence and size metadata for a batch of Commons files.
 *
 * `iiurlwidth` is requested but the returned `thumburl` is the nearest standard
 * thumbnail size, not the width asked for — so the width is never trusted from
 * here. The pipeline re-encodes and measures the file it wrote instead.
 */
export async function fileMetadata(titles) {
  const out = new Map();
  const list = titles.map(asFileTitle);
  for (let i = 0; i < list.length; i += 20) {
    const chunk = list.slice(i, i + 20);
    const data = await getJson(
      withQuery(COMMONS, {
        action: 'query',
        titles: chunk.join('|'),
        prop: 'imageinfo',
        iiprop: 'url|size|extmetadata',
        iiurlwidth: '2000',
        format: 'json',
        formatversion: '2',
      }),
    );
    for (const page of data.query?.pages ?? []) {
      const info = page.imageinfo?.[0];
      if (!info) {
        // No imageinfo at all means the file is not on Commons — almost always
        // a local, non-free upload. Report it; never silently drop it.
        out.set(page.title, { title: page.title, onCommons: false });
        continue;
      }
      const meta = info.extmetadata ?? {};
      out.set(page.title, {
        title: page.title,
        onCommons: true,
        originalUrl: info.url,
        thumbUrl: info.thumburl,
        originalWidth: info.width,
        originalHeight: info.height,
        licenseShortName: meta.LicenseShortName?.value ?? null,
        licenseUrl: meta.LicenseUrl?.value ?? null,
        author: stripHtml(meta.Artist?.value) || null,
        objectName: stripHtml(meta.ObjectName?.value) || null,
        // FRICTION-LOG D5: this is the field that tells you the "Type 56"
        // photograph is a Type 56-1. Two of thirty-four pilot captions had to
        // be rewritten after reading it.
        description: stripHtml(meta.ImageDescription?.value) || null,
        restrictions: meta.Restrictions?.value || null,
        credit: stripHtml(meta.Credit?.value) || null,
        pageUrl: `https://commons.wikimedia.org/wiki/${page.title.replace(/ /g, '_')}`,
      });
    }
  }
  return out;
}
