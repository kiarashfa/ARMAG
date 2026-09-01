#!/usr/bin/env node
/**
 * Candidate wordmarks for every maker that has none yet.
 *
 * A one-shot survey, not part of the entry pipeline: thirty makers × a search
 * each is thirty round trips, and doing them one at a time through
 * `image.mjs search` costs thirty reviews of mostly-irrelevant output. This
 * asks the same question once and prints only what could plausibly BE a mark.
 *
 * It downloads nothing and decides nothing. Choosing is a human's job, because
 * the rule that matters cannot be expressed as a filter: **the file must be the
 * mark, not a photograph of the mark.** Commons' best "Glock logo" hit is a
 * close-up of the logo embossed on a slide, and it passes every filter here.
 *
 *   node scripts/data/logo-candidates.mjs           # every maker without one
 *   node scripts/data/logo-candidates.mjs colt      # just these
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { fileMetadata, searchFiles } from './lib/commons.mjs';
import { licenseTypeFor } from './lib/imageref.mjs';
import { REPO_ROOT } from './lib/webp.mjs';

/** Filenames that could be a mark rather than a photograph of a thing. */
const MARK_WORDS = /(logo|wordmark|emblem|trademark|brand|schriftzug)/i;

/** A shape a wordmark is usually not: a photograph is rarely this square. */
const looksLikeAMark = (meta) => {
  if (!meta?.onCommons) return false;
  const ratio = meta.originalWidth / meta.originalHeight;
  return ratio >= 0.8;
};

const makerDir = path.join(REPO_ROOT, 'src', 'content', 'makerData');

async function makers(only) {
  const out = [];
  for (const file of (await readdir(makerDir)).filter((f) => f.endsWith('.json'))) {
    const data = JSON.parse(await readFile(path.join(makerDir, file), 'utf8'));
    if (only.length > 0 ? only.includes(data.id) : !data.logo) out.push(data);
  }
  return out;
}

/**
 * Search terms, widest first.
 *
 * The registered name is often not what the mark says — "Česká zbrojovka
 * Uherský Brod" is branded CZ, "Deutsche Waffen- und Munitionsfabriken" is DWM
 * — so the entry's own id, which is usually the short name, is tried too.
 */
function queriesFor(maker) {
  const short = maker.name.split(/[,(]/)[0].trim();
  const fromId = maker.id.replace(/-/g, ' ');
  return [...new Set([`${short} logo`, `${fromId} logo`])];
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

for (const maker of await makers(only)) {
  console.log(`\n=== ${maker.id}  (${maker.name})`);

  const titles = new Set();
  for (const query of queriesFor(maker)) {
    for (const title of await searchFiles(query, 20)) {
      if (MARK_WORDS.test(title)) titles.add(title);
    }
  }

  if (titles.size === 0) {
    console.log('    no file whose NAME suggests a mark — likely none on Commons');
    continue;
  }

  const meta = await fileMetadata([...titles].slice(0, 25));
  let shown = 0;
  for (const title of titles) {
    const info = meta.get(title);
    if (!looksLikeAMark(info)) continue;
    const licence = licenseTypeFor(info.licenseShortName) ?? `UNMAPPED(${info.licenseShortName})`;
    console.log(
      `    ${String(info.originalWidth).padStart(5)}×${String(info.originalHeight).padEnd(5)} ` +
        `${licence.padEnd(22)} ${title}`,
    );
    shown++;
  }
  if (shown === 0) console.log('    candidates found but none in a wordmark aspect ratio');
}

console.log(
  '\nPick with: node scripts/data/image.mjs logo <maker-slug> "File:X.png"\n' +
    'The file must BE the mark. A photograph of a logo on a receiver is not one.',
);
