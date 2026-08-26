#!/usr/bin/env node
/**
 * Lays the render fixture into `src/content/` — and takes it out again.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Three things can only be tested against the REAL pipeline: that the
 * catalogue artifact is generated from content, that the server-rendered rows
 * appear with JavaScript disabled, and that Pagefind finds an entry by an
 * ALIAS rather than its title (Instruction.md Phase 5). All three need at
 * least one entry to exist, and until Phase 8 authors the pilot batch there
 * is none.
 *
 * So the check is: lay the fixture, build, assert, clear. This script is the
 * "lay" and the "clear", committed so the verification is reproducible by
 * anyone rather than something I did once by hand and reported.
 *
 * ── NEVER COMMIT WHAT THIS WRITES ──────────────────────────────────────────
 * The fixture is a fictional firearm. In `src/content/` it renders as a real
 * page, which is fabricated data of exactly the kind SPEC.md exists to
 * prevent. Run `npm run fixture:clear` before committing. `npm run
 * check:content` will happily pass on it — it is valid content, it is just not
 * true — so the guard here is discipline, not a gate.
 *
 *   npm run fixture:lay
 *   npm run build
 *   npm run fixture:clear
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CONTENT = path.join(ROOT, 'src', 'content');

const FILES = [
  'guns/fixture-model-a.mdx',
  'gunData/fixture-model-a.json',
  'guns/fixture-model-b.mdx',
  'gunData/fixture-model-b.json',
  'cartridges/fixture-9mm.mdx',
  'cartridgeData/fixture-9mm.json',
  'makers/fixture-arms.mdx',
  'makerData/fixture-arms.json',
];

if (process.argv.includes('--remove')) {
  for (const file of FILES) await rm(path.join(CONTENT, file), { force: true });
  console.log('fixture removed from src/content/');
  process.exit(0);
}

const { FIXTURE_GUN, FIXTURE_GUN_B, FIXTURE_CARTRIDGE, FIXTURE_MAKER } = await import(
  pathToFileURL(path.join(ROOT, 'test-fixtures', 'render', 'fixture-entry.ts')).href
);

for (const dir of ['guns', 'gunData', 'cartridges', 'cartridgeData', 'makers', 'makerData']) {
  await mkdir(path.join(CONTENT, dir), { recursive: true });
}

const GUN_BODY = `
The Model A is a short-recoil, locked-breech self-loading pistol built around a
polymer frame with steel inserts carrying the slide rails. Its most-copied
feature is the ambidextrous magazine catch introduced on the third generation,
which several unrelated designs adopted within a decade. Production has run
continuously since 1982 at two plants, and the arm was adopted under a military
designation in 1985 that it kept for thirty-two years. The cyclic rate is not
recorded here because no source states one for a semi-automatic-only pistol.
`.trim();

const GUN_B_BODY = `
The Carbine B is a simple blowback self-loading carbine sharing the Model A's
magazine pattern and cartridge, built on a folding-stock chassis. It exists in
this fixture set to be a second entry of a different type: the comparison tool,
the scale silhouette and the percentile bars all need more than one arm before
they can be looked at honestly. Production ran for seventeen years across a
single plant, and the cyclic rate below is an estimate carried from a review
rather than a manufacturer figure.
`.trim();

const CARTRIDGE_BODY = `
A tapered, rimless centrefire cartridge dimensioned to the C.I.P. datasheet
cited below. Three sourced velocity points cover barrel lengths from 102 to 152
millimetres, which is what lets a firearm page interpolate a muzzle velocity
between them and label the result as interpolated rather than measured.
`.trim();

const MAKER_BODY = `
Founded in 1963, Fixture Arms has produced pistols under its own name and under
two export designations. The entries attributed to it on this page are computed
from the manufacturer reference on each entry, never listed here by hand.
`.trim();

const write = (file, text) =>
  writeFile(path.join(CONTENT, file), text.replace(/\r\n/g, '\n'), 'utf8');

await write(
  'guns/fixture-model-a.mdx',
  `---\nid: ${FIXTURE_GUN.id}\nname: ${FIXTURE_GUN.name}\nkind: ${FIXTURE_GUN.kind}\nmakerRef: ${FIXTURE_GUN.makerRef}\nfamilyRef: null\n---\n\n${GUN_BODY}\n`,
);
await write('gunData/fixture-model-a.json', `${JSON.stringify(FIXTURE_GUN, null, 2)}\n`);

await write(
  'guns/fixture-model-b.mdx',
  `---\nid: ${FIXTURE_GUN_B.id}\nname: ${FIXTURE_GUN_B.name}\nkind: ${FIXTURE_GUN_B.kind}\nmakerRef: ${FIXTURE_GUN_B.makerRef}\nfamilyRef: null\n---\n\n${GUN_B_BODY}\n`,
);
await write('gunData/fixture-model-b.json', `${JSON.stringify(FIXTURE_GUN_B, null, 2)}\n`);

await write(
  'cartridges/fixture-9mm.mdx',
  `---\nid: ${FIXTURE_CARTRIDGE.id}\nname: ${FIXTURE_CARTRIDGE.name}\n---\n\n${CARTRIDGE_BODY}\n`,
);
await write('cartridgeData/fixture-9mm.json', `${JSON.stringify(FIXTURE_CARTRIDGE, null, 2)}\n`);

await write(
  'makers/fixture-arms.mdx',
  `---\nid: ${FIXTURE_MAKER.id}\nname: ${FIXTURE_MAKER.name}\ncountry: ${FIXTURE_MAKER.country}\n---\n\n${MAKER_BODY}\n`,
);
await write('makerData/fixture-arms.json', `${JSON.stringify(FIXTURE_MAKER, null, 2)}\n`);

console.log('fixture laid into src/content/ —', FILES.length, 'files');
