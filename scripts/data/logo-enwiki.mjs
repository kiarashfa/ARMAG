#!/usr/bin/env node
/**
 * Wordmark candidates from English Wikipedia's LOCAL uploads.
 *
 * Commons carries a mark for about a third of the makers on this site and
 * nothing for the rest — Heckler & Koch, Winchester, Springfield Armory, Glock,
 * FN Herstal all draw a blank there. That is not an accident: a company logo is
 * usually not freely licensed, so Commons will not host it, and English
 * Wikipedia holds it as a local upload instead.
 *
 * Those files are exactly the marks this site wants beside a maker's name, and
 * `image.mjs logo` records them as `trademark-nominative-use` with the source
 * page in the note. This script only finds candidates; it downloads nothing.
 *
 *   node scripts/data/logo-enwiki.mjs "Heckler & Koch" "Glock" …
 */
import { getJson, withQuery } from './lib/http.mjs';

/**
 * `--lang de` and friends. A German, French or Russian article often carries a
 * mark the English one does not — MAS is French, Erma German, Izhmash Russian,
 * and each local Wikipedia holds the logo its own editors uploaded.
 */
const langIndex = process.argv.indexOf('--lang');
const LANG = langIndex === -1 ? 'en' : process.argv[langIndex + 1];
const API = `https://${LANG}.wikipedia.org/w/api.php`;

const MARK = /(logo|wordmark|emblem|marque|schriftzug)/i;

/** Wikipedia's own furniture, which matches MARK and is never what we want. */
const CHROME = /^File:(Commons-logo|Wikidata-logo|Wiktionary-logo|Wikisource-logo|Flag of)/i;

/** Every image on an article, with the direct URL and whether it is local. */
async function imagesOn(title) {
  const data = await getJson(
    withQuery(API, {
      action: 'query',
      titles: title,
      redirects: '1',
      generator: 'images',
      gimlimit: '100',
      prop: 'imageinfo',
      iiprop: 'url|size|mime',
      // A rendered PNG of every SVG, at a width the thumbnailer will actually
      // serve. Constructing this URL by hand returns HTTP 400 for the non-free
      // logos this script exists to find, so it is asked for, not guessed.
      iiurlwidth: '960',
      format: 'json',
      formatversion: '2',
    }),
  );
  return (data.query?.pages ?? [])
    .map((page) => ({
      title: page.title,
      url: page.imageinfo?.[0]?.url ?? '',
      width: page.imageinfo?.[0]?.width ?? 0,
      height: page.imageinfo?.[0]?.height ?? 0,
      mime: page.imageinfo?.[0]?.mime ?? '',
      thumb: page.imageinfo?.[0]?.thumburl ?? '',
    }))
    .filter((image) => image.url);
}

const titles = process.argv
  .slice(2)
  .filter((arg, i) => arg !== '--lang' && i !== langIndex - 1);

for (const title of titles) {
  console.log(`\n=== ${title}`);
  let images;
  try {
    images = await imagesOn(title);
  } catch (error) {
    console.log(`    lookup failed: ${error.message}`);
    continue;
  }

  const marks = images.filter((image) => MARK.test(image.title) && !CHROME.test(image.title));
  if (marks.length === 0) {
    console.log('    no image on this article is named like a mark');
    continue;
  }
  for (const mark of marks) {
    // `/wikipedia/en/` is a local upload — usually the fair-use company logo.
    // `/wikipedia/commons/` is the freely licensed one `image.mjs logo` can
    // also take by File: title.
    const where = mark.url.includes('/wikipedia/commons/') ? 'commons' : `${LANG}wiki`;
    // The PNG for an SVG, the file itself otherwise — either way, a URL that
    // `image.mjs logo` can take as-is.
    const usable = (/svg/i.test(mark.mime) ? mark.thumb : mark.url).split('?')[0];
    console.log(`    ${where.padEnd(8)} ${String(mark.width).padStart(5)}×${String(mark.height).padEnd(5)} ${mark.title}`);
    console.log(`             ${usable}`);
  }
}
