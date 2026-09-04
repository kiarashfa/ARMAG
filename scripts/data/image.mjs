#!/usr/bin/env node
/**
 * Image pipeline: a Wikipedia article or a Commons file → a licensed, measured,
 * capped WebP on disk and an `imageRef` block ready to paste.
 *
 *   node scripts/data/image.mjs find    "AK-47"          # Commons, from an article
 *   node scripts/data/image.mjs search  "Remington 870"      # Commons, full text
 *   node scripts/data/image.mjs cat     "AK-47"              # Commons, by category
 *   node scripts/data/image.mjs dvids   "M4 carbine"         # US military, in service
 *   node scripts/data/image.mjs si      "Colt revolver"      # Smithsonian, CC0 specimens
 *   node scripts/data/image.mjs licence "File:AK-47 type II noBG.png"
 *   node scripts/data/image.mjs add     "File:AK-47 type II.jpg" guns/ak-47 hero
 *   node scripts/data/image.mjs add     dvids:image:6219032      guns/m4 in-service
 *   node scripts/data/image.mjs add     si:NMAH-AHB2015q114865   guns/colt-saa specimen
 *   node scripts/data/image.mjs credit  ak-47                      # bibliography rows
 *
 * ── Three sources, because one was never enough ────────────────────────────
 * Commons has isolated specimen photographs and runs out on the long tail.
 * DVIDS has 1.8M US military photographs of arms **in service** — the shots
 * Commons almost never has. Smithsonian Open Access has museum accession
 * photography, CC0, which is the specimen shot again where Commons lacks one.
 * A thin gallery usually means only the first of the three was searched.
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
import { assetMeta as dvidsAsset, searchImages as dvidsSearch } from './lib/dvids.mjs';
import { objectMeta as siObject, searchObjects as siSearch } from './lib/smithsonian.mjs';
import { getBuffer } from './lib/http.mjs';
import { buildImageRef, licenseTypeFor } from './lib/imageref.mjs';
import { REPO_ROOT, capsForBasename, encodeToWebp, writeSheet } from './lib/webp.mjs';

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
 * `dvids <query>` — US military photography, licence asserted from the branch.
 *
 * DVIDS matches CAPTION TEXT, so this returns scenes that mention the arm
 * rather than photographs of it. The description is printed for exactly that
 * reason: read it before choosing, and open the image before writing a caption.
 */
async function cmdDvids(query) {
  const rows = await dvidsSearch(query, { max: 12 });
  console.log(`${rows.length} DVIDS image(s) matching "${query}"\n`);
  for (const row of rows) {
    console.log(`  ${row.id}   ${row.branch.padEnd(12)} ${row.width ?? '?'}×${row.height ?? '?'}  ${row.date}`);
    console.log(`      ${row.title}`);
    if (row.description) console.log(`      shows  : ${row.description.slice(0, 200)}`);
    if (row.unit) console.log(`      unit   : ${row.unit}`);
  }
  console.log('\nThen: image.mjs add dvids:<id> <collection>/<slug> <basename>');
}

/** `si <query>` — Smithsonian Open Access, CC0 only, museum specimen shots. */
async function cmdSmithsonian(query) {
  const rows = await siSearch(query, { max: 12 });
  console.log(`${rows.length} CC0 Smithsonian object(s) matching "${query}"\n`);
  for (const row of rows) {
    console.log(`  ${row.id.padEnd(26)} ${row.unit.padEnd(6)} ${row.title}`);
  }
  console.log('\nThen: image.mjs add si:<image id> <collection>/<slug> <basename>');
}

/**
 * A handle → the metadata `buildImageRef` needs, plus where to fetch the file.
 *
 * One function so `add` does not care which source it is talking to: every
 * adapter returns the same `SourceMeta` shape, and every one of them resolves
 * the licence BEFORE anything is downloaded (Instruction.md Phase 9).
 */
/**
 * SVG is refused, with the way out named.
 *
 * Most company wordmarks exist only as SVG, and the encoder is Pillow, which
 * does not rasterise it. Wikimedia's thumbnailer will render one — but only at
 * widths it is willing to serve, and a hand-built thumb URL returns HTTP 400
 * for exactly the non-free logos this path exists for. So the URL is not
 * guessed here: `logo-enwiki.mjs` asks the API for the rendered PNG and prints
 * it, and that is what gets pasted in.
 */
function refuseSvg(url) {
  if (!/\.svg(\?|$)/i.test(url)) return url;
  throw new Error(
    `${url} is an SVG, and the encoder cannot rasterise one. For a Wikipedia-hosted mark run ` +
      '`node scripts/data/logo-enwiki.mjs "<Article>"`, which prints a rendered PNG URL for each ' +
      'candidate. Otherwise find a PNG or JPEG of the same mark.',
  );
}

async function resolveSource(handle, { from = null } = {}) {
  /**
   * A direct image URL — the route for a manufacturer's own wordmark.
   *
   * Commons has a mark for about a third of the makers on this site and
   * nothing at all for the rest, including Heckler & Koch, Winchester,
   * Springfield Armory and Glock. A wordmark is not a photograph: the question
   * it raises is trademark, not copyright, and identifying a manufacturer
   * beside its own entry is nominative use however the file was served. So
   * this path exists, it is only reachable from `logo`, and it demands
   * `--from` — the page the mark was taken from — because a credit that
   * points at a bare image file tells a reader nothing about where it came
   * from.
   */
  if (/^https?:\/\//i.test(handle)) {
    if (!from) {
      throw new Error(
        'a direct image URL needs --from "<page the mark was taken from>", normally the ' +
          "manufacturer's own site. The credit records the page, never the raw image file.",
      );
    }
    return {
      meta: { pageUrl: from, title: null, description: null, licenseShortName: null },
      download: refuseSvg(handle),
      label: handle,
    };
  }

  if (/^dvids:/i.test(handle)) {
    const meta = await dvidsAsset(handle.replace(/^dvids:/i, ''));
    return { meta, download: meta.downloadUrl, label: handle };
  }
  if (/^si:/i.test(handle)) {
    const meta = await siObject(handle.replace(/^si:/i, ''));
    return { meta, download: meta.downloadUrl, label: handle };
  }

  const file = asFileTitle(handle);
  const meta = (await fileMetadata([file])).get(file);
  if (!meta?.onCommons) {
    throw new Error(
      `${file} is not on Commons — do not use it. If you guessed the filename, stop guessing: ` +
        'run `image.mjs find "<Article title>"` and use only a file it listed. ' +
        'For a US service arm try `image.mjs dvids "<name>"`, for a museum specimen `image.mjs si "<name>"`.',
    );
  }
  return { meta, download: meta.thumbUrl ?? meta.originalUrl, label: file };
}

/**
 * `sheet <name> <handle> [handle …]` — one numbered contact sheet for triage.
 *
 * §6 asks for three searches per subject, which routinely leaves more
 * candidates than are worth opening. Opening three to five at full size in
 * order to reject most of them is what makes an image pass expensive: the
 * sibling recipe site measured 321 k tokens for 70 subjects before it worked
 * this way.
 *
 * Takes handles from any of the three sources — `File:X.jpg`,
 * `dvids:image:N`, `si:ID` — because `resolveSource` already normalises them,
 * so one sheet can compare a Commons specimen against a DVIDS in-service shot
 * side by side, which is exactly the judgement §6 asks for.
 *
 * Writes to `.cache/sheets/`, which is gitignored: a sheet is scratch for
 * choosing, never an asset. **Triage only** — the tiles cannot show a
 * watermark, a date stamp, or which variant a receiver is, so fetch the
 * finalist properly before `add`.
 */
async function cmdSheet(name, handles) {
  if (!name || handles.length === 0) {
    throw new Error('usage: image.mjs sheet <name> <handle> [handle …]');
  }
  const tiles = [];
  const failed = [];
  for (const [i, handle] of handles.entries()) {
    const label = String(i + 1).padStart(2, '0');
    try {
      const { download, label: resolved } = await resolveSource(handle);
      tiles.push({ label, bytes: await getBuffer(download) });
      console.log(`  ${label}  ${resolved}`);
    } catch (error) {
      failed.push(`  ${label}  ${handle} — ${error.message}`);
    }
  }
  if (failed.length) {
    console.log('\ncould not fetch:');
    for (const line of failed) console.log(line);
  }
  if (tiles.length === 0) throw new Error('nothing could be fetched; no sheet written');

  const out = path.join(REPO_ROOT, '.cache', 'sheets', `${name}.webp`);
  const result = await writeSheet(tiles, out);
  for (const skip of result.skipped) console.log(`  skipped ${skip}`);
  console.log(
    `\n${result.drawn} candidate(s): ${path.relative(REPO_ROOT, out)}\n` +
      'Read the sheet, pick the number that could be right, then fetch that one ' +
      'properly before `add` — the sheet is triage and is too small to show a ' +
      'watermark, a date stamp, or which variant it is.',
  );
}

/**
 * `add <file> <collection/slug> <basename>`
 *
 * `collection/slug` is `guns/ak-47` or `cartridges/9x19mm-parabellum`, matching
 * `public/images/<collection>/<slug>/` exactly as SPEC.md §4 lays it out. It is
 * taken as one argument rather than two because the two-argument form invites
 * `image.mjs add file ak-47 hero`, which silently writes to the wrong tree.
 */
async function cmdAdd(rawFile, target, basename, { replace = false, licence = null, from = null } = {}) {
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

  const resolved = await resolveSource(rawFile, { from });
  // A licence override is how `logo` works: see `cmdLogo` for why a wordmark is
  // recorded as nominative trademark use whatever the source reports about the
  // image file, and why what the source reported is kept in the note rather
  // than discarded.
  const meta = licence ? { ...resolved.meta, ...licence(resolved.meta) } : resolved.meta;

  const relative = path.join('public', 'images', ...target.split('/'), `${basename}.webp`);
  const destination = path.join(REPO_ROOT, relative);
  const caps = capsForBasename(`${basename}.webp`);

  // Licence FIRST. A file that cannot produce a valid imageRef is never fetched.
  const probe = buildImageRef({ src: relative.replace(/\\/g, '/').replace(/^public\//, ''), meta });

  const bytes = await getBuffer(resolved.download);
  // `--replace` exists because a file already on disk can be WRONG rather than
  // done: the two Phase 8 heroes were converted before this pipeline existed
  // and had their alpha channel flattened onto black, which showed as blotches
  // on the AK and a black box on the M4 in the light theme. Re-encoding is the
  // fix, and refusing to overwrite would have meant deleting by hand first.
  const encoded = await encodeToWebp(bytes, destination, { overwrite: replace });

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
  if (meta.description) console.error(`\nThe source says this file shows:\n  ${meta.description}`);
  console.error(
    '\nNow replace both TODOs. `alt` describes what is visible for a reader who cannot see it;\n' +
      '`caption` says what it actually shows, INCLUDING the variant if it is not this entry.',
  );
  console.log(JSON.stringify(imageRef, null, 2));
}

/**
 * `logo <maker-slug> <File:...>` — a manufacturer's wordmark.
 *
 * A wordmark is not a photograph and its licence question is a different one.
 * The image file on Commons may be tagged public domain (a plain text logo
 * below the threshold of originality), "copyrighted free use", or nothing
 * usable at all — but the thing that actually governs reproducing a maker's
 * mark beside its own entry is trademark, not copyright, and identifying the
 * manufacturer is the textbook nominative use. So the ref is recorded as
 * `trademark-nominative-use`, and what Commons said about the file is kept in
 * the `licenseNote` rather than thrown away: the record should say what was
 * found, not only what was concluded.
 *
 * This is the one place the licence is asserted rather than mapped, which is
 * why it is a separate command with its own name instead of a flag on `add`.
 * Everything else — the download, the WebP cap, the schema validation — is the
 * same code path.
 */
async function cmdLogo(slug, rawFile, { replace = false, from = null } = {}) {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`maker slug must be lowercase-kebab, e.g. beretta — got "${slug ?? '(nothing)'}"`);
  }
  await cmdAdd(rawFile, `makers/${slug}`, 'logo', {
    replace,
    from,
    licence: (meta) => ({
      licenseType: 'trademark-nominative-use',
      licenseNote:
        `${meta.licenseShortName ? `The source records the file as ${meta.licenseShortName}. ` : ''}` +
        'The mark itself is its owner\'s trademark, reproduced here to identify the ' +
        'manufacturer whose entry it appears on, which is nominative use.',
    }),
  });
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

const argv = process.argv.slice(2);
const replace = argv.includes('--replace');
const fromIndex = argv.indexOf('--from');
const from = fromIndex === -1 ? null : argv[fromIndex + 1];
// `fromIndex + 1` is only a value position when `--from` was actually passed;
// without the guard it is 0, which silently eats the command itself.
const fromValueIndex = fromIndex === -1 ? -1 : fromIndex + 1;
const [command, ...args] = argv.filter(
  (arg, i) => arg !== '--replace' && arg !== '--from' && i !== fromValueIndex,
);
try {
  if (command === 'find') await cmdFind(args[0]);
  else if (command === 'search') await cmdSearch(args.join(' '));
  else if (command === 'cat') await cmdCat(args[0]);
  else if (command === 'dvids') await cmdDvids(args.join(' '));
  else if (command === 'si') await cmdSmithsonian(args.join(' '));
  else if (command === 'licence' || command === 'license') await cmdLicence(args[0]);
  else if (command === 'add') await cmdAdd(args[0], args[1], args[2], { replace });
  else if (command === 'logo') await cmdLogo(args[0], args[1], { replace, from });
  else if (command === 'sheet') await cmdSheet(args[0], args.slice(1));
  else if (command === 'credit') await cmdCredit(args[0]);
  else {
    console.error(
      'usage: image.mjs find "Article" | search "words" | cat "Category" | licence "File:X.jpg"\n' +
        '       image.mjs dvids "words"   (US military, in service)   | si "words"  (Smithsonian, CC0)\n' +
        '       image.mjs add <File:X.jpg | dvids:image:N | si:IDSID> guns/<slug> <basename> [--replace]\n' +
        '       image.mjs logo <maker-slug> <File:X.png | https://…> [--from <page>] [--replace]\n' +
        '       image.mjs sheet <name> <handle> [handle …]   (one tiled sheet, ALL THREE sources)\n' +
        '       image.mjs credit <slug>',
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
