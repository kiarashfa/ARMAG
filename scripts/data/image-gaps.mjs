#!/usr/bin/env node
/**
 * Which entries are short of photographs, and what Commons has for them.
 *
 * The companion to `logo-candidates.mjs`, and there for the same reason: a
 * survey across the whole catalogue is one question asked once, where the
 * per-entry commands are the same question asked sixty times. It downloads
 * nothing and decides nothing.
 *
 * An entry with **no** image sits below the publication floor (SPEC.md §5.9) —
 * it is a catalogue row with no page — so zero is the number that costs
 * something, and it is what this reports first.
 *
 *   node scripts/data/image-gaps.mjs              # list the gaps, no searching
 *   node scripts/data/image-gaps.mjs --search     # and what Commons offers
 *   node scripts/data/image-gaps.mjs --search --max 2   # only entries under 2
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { fileMetadata, searchFiles } from './lib/commons.mjs';
import { licenseTypeFor } from './lib/imageref.mjs';
import { REPO_ROOT } from './lib/webp.mjs';

const argv = process.argv.slice(2);
const wantSearch = argv.includes('--search');
const maxImages = Number(argv[argv.indexOf('--max') + 1]) || 1;

const COLLECTIONS = [
  { dir: 'gunData', label: 'gun', target: 'guns' },
  { dir: 'cartridgeData', label: 'cartridge', target: 'cartridges' },
];

async function gaps() {
  const out = [];
  for (const collection of COLLECTIONS) {
    const full = path.join(REPO_ROOT, 'src', 'content', collection.dir);
    for (const file of (await readdir(full)).filter((f) => f.endsWith('.json'))) {
      const data = JSON.parse(await readFile(path.join(full, file), 'utf8'));
      const count = (data.images ?? []).length;
      if (count < maxImages) {
        out.push({ ...collection, id: data.id, name: data.name, count });
      }
    }
  }
  // Zero first: those are the entries that have no page at all.
  return out.sort((a, b) => a.count - b.count || a.id.localeCompare(b.id));
}

const rows = await gaps();
console.log(`${rows.length} entr(ies) with fewer than ${maxImages} image(s).\n`);

if (!wantSearch) {
  for (const row of rows) {
    console.log(`  ${String(row.count)}  ${row.label.padEnd(9)} ${row.id.padEnd(28)} ${row.name}`);
  }
  console.log('\nRe-run with --search to see what Commons has for each.');
  process.exit(0);
}

for (const row of rows) {
  console.log(`\n=== ${row.id}  (${row.name})  — has ${row.count}`);
  const titles = new Set();
  for (const query of [row.name, `${row.name} cartridge`]) {
    for (const title of await searchFiles(query, 12)) titles.add(title);
    if (titles.size >= 12) break;
  }

  const meta = await fileMetadata([...titles].slice(0, 20));
  let shown = 0;
  for (const title of titles) {
    const info = meta.get(title);
    if (!info?.onCommons) continue;
    const licence = licenseTypeFor(info.licenseShortName);
    // Unmapped licences are refused at `add` time anyway; not offering them
    // here keeps the list to files that can actually be used.
    if (!licence) continue;
    console.log(
      `    ${String(info.originalWidth).padStart(5)}×${String(info.originalHeight).padEnd(5)} ` +
        `${licence.padEnd(14)} ${title}`,
    );
    if (++shown >= 6) break;
  }
  if (shown === 0) console.log('    nothing usable on Commons — try `image.mjs si` and `dvids`');
}
