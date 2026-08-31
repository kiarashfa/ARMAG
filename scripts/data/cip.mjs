#!/usr/bin/env node
/**
 * C.I.P. TDCC — free dimensional and pressure standards for cartridges.
 *
 *   node scripts/data/cip.mjs sync                 # cache the 12 index pages, once
 *   node scripts/data/cip.mjs find "9x19"
 *   node scripts/data/cip.mjs sheet "9 mm Luger"
 *
 * FRICTION-LOG A3: this is the best free cartridge source there is, and its site
 * is undiscoverable. `bobp.cip-bobp.org/en/tdcc` is a 404; the real index is
 * `/en/tdcc_public?page=1&cartridge_type_id=N` for N in 1..12. The friction log
 * called caching that mapping "a half-day of work that pays for itself at entry
 * 15" — this is that half-day.
 *
 * Two things the caching buys beyond speed:
 *  - the index rows carry **maximum average pressure directly**, so a cartridge
 *    that needs only `maxPressure` never fetches a PDF at all;
 *  - `find` searches every table at once, which matters because nobody knows
 *    which of the twelve a cartridge is in, and C.I.P.'s own name for it is
 *    rarely the one you looked it up under (`9 mm Luger`, not `9×19mm`).
 *
 * SPEC.md Appendix A: **transcribe the numbers, never republish the drawings.**
 * The PDF is fetched, read for a dozen figures, and not kept.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getBuffer, getText } from './lib/http.mjs';
import {
  CARTRIDGE_DIMENSIONS,
  OTHER_LETTERS,
  TDCC_TABLES,
  parseDatasheet,
  parseIndex,
  searchIndex,
} from './lib/cip-parse.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CACHE = path.join(REPO_ROOT, '.cache', 'cip-index.json');
const BASE = 'https://bobp.cip-bobp.org';

async function loadIndex() {
  const raw = await readFile(CACHE, 'utf8').catch(() => null);
  if (!raw) {
    throw new Error(
      'no cached C.I.P. index. Run `node scripts/data/cip.mjs sync` once — it fetches twelve pages ' +
        'and then nothing else touches their site.',
    );
  }
  return JSON.parse(raw);
}

async function cmdSync() {
  const rows = [];
  for (const [id, label] of Object.entries(TDCC_TABLES)) {
    const html = await getText(`${BASE}/en/tdcc_public?page=1&cartridge_type_id=${id}`);
    const parsed = parseIndex(html, Number(id));
    console.error(`table ${String(id).padStart(2)}  ${parsed.length.toString().padStart(4)} row(s)  ${label}`);
    rows.push(...parsed);
  }
  await mkdir(path.dirname(CACHE), { recursive: true });
  await writeFile(
    CACHE,
    `${JSON.stringify(
      {
        note: 'Cached C.I.P. TDCC index. Regenerate with `cip.mjs sync`. Not committed — it is a copy of someone else\'s index and SPEC.md Appendix A forbids bulk mirroring.',
        fetched: new Date().toISOString().slice(0, 10),
        source: `${BASE}/en/tdcc_public`,
        rows,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.error(`\ncached ${rows.length} cartridge(s) → ${path.relative(REPO_ROOT, CACHE)}`);
}

async function cmdFind(query) {
  const { rows, fetched } = await loadIndex();
  const hits = searchIndex(rows, query);
  console.log(`${hits.length} match(es) for "${query}"  (index cached ${fetched})\n`);
  for (const hit of hits) {
    const pressure = hit.pmaxBar
      ? `Pmax ${hit.pmaxBar} bar = ${(hit.pmaxBar / 10).toFixed(1)} MPa`
      : 'Pmax not listed';
    console.log(`  ${hit.name}`);
    console.log(`    table ${hit.table} · ${hit.country ?? '?'} · adopted ${hit.adopted ?? '?'} · revised ${hit.revised ?? '—'}`);
    console.log(`    ${pressure}`);
    console.log(`    ${hit.datasheetUrl ?? '(no English datasheet)'}`);
  }
  if (hits.length === 0) {
    console.log(
      'Nothing. C.I.P. standardises the COMMERCIAL round, not the military one — FRICTION-LOG A4:\n' +
        'there is no free dimensional standard for 5.56×45mm NATO, 7.62×51mm NATO or 5.45×39mm.\n' +
        'Look up the commercial equivalent, record the figure as `estimated`, and say in the note\n' +
        'exactly which cartridge it was borrowed from. Do not present it as the military standard.',
    );
  }
}

function runPython(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('python', [script, ...args], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (error) =>
      reject(new Error(`could not run python (${error.message}); PyMuPDF is needed to read the datasheet`)),
    );
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err || `python exited ${code}`))));
  });
}

async function cmdSheet(query) {
  const { rows } = await loadIndex();
  const hits = searchIndex(rows, query).filter((h) => h.datasheetUrl);
  if (hits.length === 0) throw new Error(`no datasheet found for "${query}" — try \`cip.mjs find\` first`);
  if (hits.length > 1) {
    console.error(`${hits.length} matches; using "${hits[0].name}". The others:`);
    for (const hit of hits.slice(1)) console.error(`  ${hit.name}`);
  }
  const row = hits[0];

  const pdf = await getBuffer(row.datasheetUrl);
  await mkdir(path.join(REPO_ROOT, '.cache'), { recursive: true });
  const temp = path.join(REPO_ROOT, '.cache', 'cip-sheet.pdf');
  await writeFile(temp, pdf);
  const text = await runPython(path.join(REPO_ROOT, 'scripts', 'data', 'lib', 'pdftext.py'), [temp]);
  const sheet = parseDatasheet(text);

  console.log(`# ${row.name}  (C.I.P. TDCC table ${row.table})`);
  console.log(`  adopted ${row.adopted ?? '?'}, revised ${row.revised ?? '—'}`);
  if (sheet.meta.alternativeNames) console.log(`  also called: ${sheet.meta.alternativeNames}`);
  console.log(`  ${row.datasheetUrl}\n`);

  console.log('CARTRIDGE MAXI — dimensions of the round. These are the schema fields.');
  for (const { letter, field, label } of CARTRIDGE_DIMENSIONS) {
    const found = sheet.cartridge[letter];
    console.log(
      `  ${letter.padEnd(4)} ${String(found?.value ?? '—').padEnd(9)} mm   ${field.padEnd(16)} ${label}`,
    );
  }

  const pmax = sheet.meta.Pmax?.value ?? row.pmaxBar;
  if (pmax) {
    console.log(
      `\n  Pmax ${pmax} bar  →  maxPressure ${(pmax / 10).toFixed(1)} MPa   (1 bar = 0.1 MPa exactly)`,
    );
  }

  console.log('\nCHAMBER MINI — dimensions of the BARREL. Not cartridge fields. Do not record them as such.');
  for (const [letter, found] of Object.entries(sheet.chamber)) {
    if (!found.value) continue;
    const meaning = OTHER_LETTERS[letter] ?? '';
    console.log(`  ${letter.padEnd(6)} ${String(found.value).padEnd(9)} ${meaning}`);
  }

  const twist = sheet.chamber.u?.value;
  if (twist) {
    console.log(
      `\n  u = ${twist} mm is the rifling twist the STANDARD specifies for a barrel in this\n` +
        '  chambering. It belongs on a gun as `riflingTwistMm` only if that gun is actually\n' +
        '  built to the C.I.P. chamber; for a military arm it usually is not.',
    );
  }

  console.log('\n--- reference entry ---');
  console.log(
    JSON.stringify(
      {
        key: `cip-${row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
        type: 'standards-body',
        title: `C.I.P. TDCC datasheet — ${row.name}`,
        publisher: 'Commission Internationale Permanente pour l’Épreuve des Armes à Feu Portatives',
        url: row.datasheetUrl,
        // A standards-body citation without an edition fails the schema: these
        // documents are revised, and the revision date is on the sheet.
        revision: row.revised ?? row.adopted ?? undefined,
        accessed: new Date().toISOString().slice(0, 10),
      },
      null,
      2,
    ),
  );
  console.log(
    '\nSPEC.md Appendix A: the numbers above are transcribed; the drawing is not republished.\n' +
      'The PDF was read and not kept.',
  );
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'sync') await cmdSync();
  else if (command === 'find') await cmdFind(args.join(' '));
  else if (command === 'sheet') await cmdSheet(args.join(' '));
  else {
    console.error('usage: cip.mjs sync | find "9x19" | sheet "9 mm Luger"');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
