#!/usr/bin/env node
/**
 * Image pipeline: a Wikipedia article or a Commons file → a licensed, measured,
 * capped WebP on disk and an `imageRef` block ready to paste.
 *
 *   node scripts/data/image.mjs find    "AK-47"
 *   node scripts/data/image.mjs search  "Remington 870 shotgun"
 *   node scripts/data/image.mjs cat     "AK-47"
 *   node scripts/data/image.mjs licence "File:AK-47 type II noBG.png"
 *   node scripts/data/image.mjs add     "File:AK-47 type II.jpg" guns/ak-47 hero
 *   node scripts/data/image.mjs credit  ak-47                      # bibliography rows
 *
 * `add` is the whole phase in one command: fetch → licence capture → WebP →
 * cap enforcement → measure → emit. Instruction.md Phase 9's definition of done
 * is that it **cannot emit an `imageRef` missing licence data**, and that is
 * enforced in `lib/imageref.mjs` by parsing through the same Zod schema the
 * content build uses — not by a check in this file that could be skipped.
 *
 * Order of operations matters and is not arbitrary: licence is resolved
 * **before** anything is downloaded. Fetching first and asking afterwards
 * leaves unusable files on disk that someone later assumes were cleared.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';

import {
  articleImages,
  asFileTitle,
  categoryMembers,
  commonsCategory,
  fileMetadata,
  searchFiles,
  wikidataIdFor,
} from './lib/commons.mjs';
import { getBuffer } from './lib/http.mjs';
import { buildImageRef, licenseTypeFor } from './lib/imageref.mjs';
import { REPO_ROOT, capsForBasename, encodeToWebp } from './lib/webp.mjs';

const kb = (bytes) => `${Math.round(bytes / 1024)} kB`;

function describeLicence(meta) {
  if (!meta?.onCommons) return 'NOT ON COMMONS — likely a non-free local upload, do not use';
  const mapped = licenseTypeFor(meta.licenseShortName);
  return mapped ?? `UNMAPPED (${meta.licenseShortName ?? 'no licence reported'})`;
}

function report(file, meta) {
  const licence = describeLicence(meta);
  const size = meta?.onCommons ? `${meta.originalWidth}×${meta.originalHeight}` : '';
  console.log(`  ${licence.padEnd(16)} ${size.padEnd(12)} ${file}`);
  if (meta?.onCommons) {
    console.log(`      author : ${meta.author || '(none recorded)'}`);
    // FRICTION-LOG D5 — read this before writing the caption. It is what says
    // the photograph is a Type 56-1 rather than a Type 56.
    if (meta.description) console.log(`      shows  : ${meta.description.slice(0, 220)}`);
    if (meta.restrictions) console.log(`      ⚠ RESTRICTIONS: ${meta.restrictions}`);
  }
}

async function cmdFind(title) {
  const qid = await wikidataIdFor(title);
  const category = await commonsCategory(qid);
  console.log(`article  : ${title}`);
  console.log(`wikidata : ${qid ?? '(none)'}`);
  console.log(`P373     : ${category ?? '(none)'}\n`);

  const used = await articleImages(title);
  console.log(`— images used in the article (${used.length}) — curated, prefer these`);
  const meta = await fileMetadata(used);
  for (const file of used) report(file, meta.get(asFileTitle(file)));

  if (category) {
    const direct = await categoryMembers(category, 'file');
    console.log(`\n— Category:${category} — ${direct.length} direct file(s)`);
    const subs = await categoryMembers(category, 'subcat');
    if (subs.length) {
      console.log(`  ${subs.length} subcategor(ies); category listings do not recurse:`);
      for (const sub of subs.slice(0, 25)) console.log(`    ${sub}`);
      console.log('  list one with: image.mjs cat "<category name>"');
    }
  }
  console.log(
    '\nFRICTION-LOG D4: the long tail has no photographs. If nothing here shows this exact\n' +
      'model, use the nearest one and SAY SO IN THE CAPTION — do not caption it as the model.',
  );
}

async function cmdSearch(query) {
  const files = await searchFiles(query);
  console.log(`${files.length} file(s) matching "${query}"`);
  const meta = await fileMetadata(files);
  for (const file of files) report(file, meta.get(asFileTitle(file)));
}

async function cmdCat(category) {
  const files = await categoryMembers(category, 'file');
  const subs = await categoryMembers(category, 'subcat');
  console.log(`Category:${category} — ${files.length} file(s), ${subs.length} subcategor(ies)`);
  const meta = await fileMetadata(files.slice(0, 40));
  for (const file of files.slice(0, 40)) report(file, meta.get(asFileTitle(file)));
  for (const sub of subs) console.log(`  [subcat] ${sub}`);
}

async function cmdLicence(rawFile) {
  const file = asFileTitle(rawFile);
  const meta = (await fileMetadata([file])).get(file);
  console.log(JSON.stringify(meta ?? { onCommons: false }, null, 2));
  if (meta?.onCommons) {
    // Resolve the licence now, so an unusable file is refused here rather than
    // after it has been downloaded and half-authored.
    try {
      buildImageRef({ src: 'images/probe.webp', meta });
      console.error(`\nlicence resolves: ${licenseTypeFor(meta.licenseShortName)}`);
    } catch (error) {
      console.error(`\nWOULD BE REFUSED: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

/**
 * `add <file> <collection/slug> <basename>`
 *
 * `collection/slug` is `guns/ak-47` or `cartridges/9x19mm-parabellum`, matching
 * `public/images/<collection>/<slug>/` exactly as SPEC.md §4 lays it out. It is
 * taken as one argument rather than two because the two-argument form invites
 * `image.mjs add file ak-47 hero`, which silently writes to the wrong tree.
 */
async function cmdAdd(rawFile, target, basename) {
  if (!target || !/^(guns|cartridges|makers)\/[a-z0-9-]+$/.test(target)) {
    throw new Error(
      `target must be "<collection>/<slug>", e.g. guns/ak-47 — got "${target ?? '(nothing)'}"`,
    );
  }
  if (!basename || !/^[a-z0-9-]+$/.test(basename)) {
    throw new Error(
      `basename must be a lowercase filename with no extension, e.g. hero or right-profile — got "${basename ?? '(nothing)'}"`,
    );
  }

  const file = asFileTitle(rawFile);
  const meta = (await fileMetadata([file])).get(file);
  if (!meta?.onCommons) {
    throw new Error(
      `${file} is not on Commons — do not use it. If you guessed the filename, stop guessing: ` +
        'run `image.mjs find "<Article title>"` and use only a file it listed.',
    );
  }

  const relative = path.join('public', 'images', ...target.split('/'), `${basename}.webp`);
  const destination = path.join(REPO_ROOT, relative);
  const caps = capsForBasename(`${basename}.webp`);

  // Licence FIRST. A file that cannot produce a valid imageRef is never fetched.
  const probe = buildImageRef({ src: relative.replace(/\\/g, '/').replace(/^public\//, ''), meta });

  const source = meta.thumbUrl ?? meta.originalUrl;
  const bytes = await getBuffer(source);
  const encoded = await encodeToWebp(bytes, destination);

  const imageRef = buildImageRef({
    src: probe.src,
    width: encoded.width,
    height: encoded.height,
    meta,
  });

  const written = (await stat(destination)).size;
  console.error(
    `wrote ${relative.replace(/\\/g, '/')}  ${encoded.width}×${encoded.height}  ${kb(written)} ` +
      `of the ${caps.role} cap ${kb(caps.maxBytes)}  quality ${encoded.quality}` +
      `${encoded.resized ? `  (resized from ${encoded.sourceWidth}×${encoded.sourceHeight})` : ''}`,
  );
  if (meta.description) console.error(`\nCommons says this file shows:\n  ${meta.description}`);
  console.error(
    '\nNow replace both TODOs. `alt` describes what is visible for a reader who cannot see it;\n' +
      '`caption` says what it actually shows, INCLUDING the variant if it is not this entry.',
  );
  console.log(JSON.stringify(imageRef, null, 2));
}

/**
 * The bibliography rows for the images already in an entry.
 *
 * `references[]` is per entry (SPEC.md §13) and a Commons file is a citable
 * source, so an entry whose photographs came from Commons should say so. This
 * reads what is already authored rather than what is on Commons, so it can be
 * run after the fact and cannot invent a file that was never used.
 */
async function cmdCredit(slug) {
  const { readFile } = await import('node:fs/promises');
  const candidates = ['gunData', 'cartridgeData', 'makerData'].map((dir) =>
    path.join(REPO_ROOT, 'src', 'content', dir, `${slug}.json`),
  );
  let data = null;
  for (const candidate of candidates) {
    data = await readFile(candidate, 'utf8').then(JSON.parse).catch(() => null);
    if (data) break;
  }
  if (!data) throw new Error(`no data file for "${slug}" in gunData, cartridgeData or makerData`);

  const rows = (data.images ?? []).map((image, index) => ({
    key: `commons-${slug}-${index + 1}`,
    type: 'commons',
    title: image.credit.title ?? image.src,
    author: image.credit.author,
    publisher: 'Wikimedia Commons',
    url: image.credit.sourceUrl,
    accessed: new Date().toISOString().slice(0, 10),
    license: image.credit.licenseType,
  }));
  console.log(JSON.stringify(rows, null, 2));
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'find') await cmdFind(args[0]);
  else if (command === 'search') await cmdSearch(args.join(' '));
  else if (command === 'cat') await cmdCat(args[0]);
  else if (command === 'licence' || command === 'license') await cmdLicence(args[0]);
  else if (command === 'add') await cmdAdd(args[0], args[1], args[2]);
  else if (command === 'credit') await cmdCredit(args[0]);
  else {
    console.error(
      'usage: image.mjs find "Article" | search "words" | cat "Category" | licence "File:X.jpg"\n' +
        '       image.mjs add "File:X.jpg" guns/<slug> <basename>   (basename: hero, or a descriptive name)\n' +
        '       image.mjs credit <slug>',
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
