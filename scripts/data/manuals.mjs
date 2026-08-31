#!/usr/bin/env node
/**
 * Public-domain US military manuals — the densest free source there is.
 *
 *   node scripts/data/manuals.mjs list
 *   node scripts/data/manuals.mjs check
 *   node scripts/data/manuals.mjs find "TM 9-1005-313-10"
 *
 * FRICTION-LOG A2 asked for "a small mirror table of known-good manual URLs
 * rather than searching for them each time". Building it found the reason a
 * bare table is not enough: **two of the three mirrors the friction log
 * recorded as working on 2026-08-27 were dead four days later** — `bits.de`
 * 403s and `pdf.textfiles.com` does not resolve. A table of URLs rots faster
 * than the manuals do.
 *
 * So the table records the *designation*, which is what
 * `referenceEntry.revision` requires and what someone re-finds the document by,
 * and `check` re-probes the URLs so the rot is visible instead of silent.
 * `find` is the fallback that does not rot: the Internet Archive holds these
 * documents under permanent identifiers, and `archive.org/details/<id>` is a
 * clickable URL, so a figure from one can reach `verified` (gate 2).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { get, getJson, withQuery } from './lib/http.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TABLE = path.join(REPO_ROOT, 'scripts', 'data', 'sources', 'manuals.json');

const load = async () => JSON.parse(await readFile(TABLE, 'utf8'));

async function cmdList() {
  const table = await load();
  console.log(`${table.manuals.length} manual(s), table checked ${table.checked}\n`);
  for (const manual of table.manuals) {
    console.log(`${manual.designation} — ${manual.title} (${manual.year})`);
    console.log(`  covers : ${manual.covers.join(', ')}`);
    console.log(`  holds  : ${manual.contents}`);
    for (const url of manual.urls) console.log(`  ${url.host}: ${url.url}`);
    console.log('');
  }
  console.log('Hosts known to be dead:');
  for (const dead of table.deadHosts) console.log(`  ${dead.host} — ${dead.note}`);
}

async function cmdCheck() {
  const table = await load();
  let failures = 0;
  for (const manual of table.manuals) {
    for (const entry of manual.urls) {
      let status;
      try {
        const response = await get(entry.url, { retries: 0, timeoutMs: 30000 });
        status = response.status;
      } catch (error) {
        status = /HTTP (\d+)/.exec(error.message)?.[1] ?? 'unreachable';
      }
      const ok = String(status) === '200';
      if (!ok) failures += 1;
      console.log(`${ok ? 'ok  ' : 'DEAD'} ${String(status).padEnd(12)} ${manual.designation}  ${entry.url}`);
    }
  }
  if (failures) {
    console.log(
      `\n${failures} dead link(s). The citation is still valid — it names the designation, not the host.\n` +
        'Run `manuals.mjs find "<designation>"` for a permanent Internet Archive identifier, then\n' +
        'update sources/manuals.json.',
    );
  }
}

async function cmdFind(designation) {
  const data = await getJson(
    withQuery('https://archive.org/advancedsearch.php', {
      q: `"${designation}"`,
      output: 'json',
      rows: '10',
      'fl[]': 'identifier',
    }),
  );
  // The API takes repeated `fl[]` parameters; `withQuery` can only set one, so
  // the title and year come from the metadata endpoint below rather than here.
  const docs = data.response?.docs ?? [];
  console.log(`${data.response?.numFound ?? 0} item(s) mentioning "${designation}"\n`);
  for (const doc of docs) {
    console.log(`  ${doc.identifier}`);
    console.log(`    https://archive.org/details/${doc.identifier}`);
  }
  console.log(
    '\nThis is a FULL-TEXT search, so it returns anything that mentions the string — one query\n' +
      'for "TM 9-1005-319-10" returned a SoundCloud track. Open the item before citing it.\n\n' +
      '--- reference entry, once you have chosen one ---',
  );
  console.log(
    JSON.stringify(
      {
        key: designation.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        type: 'military-manual',
        title: 'TITLE AS PRINTED ON THE COVER',
        publisher: 'Headquarters, Department of the Army',
        url: 'https://archive.org/details/<identifier>',
        // A military-manual citation without its designation cannot be found at
        // all, so the schema requires it here.
        revision: designation,
        year: 0,
        accessed: new Date().toISOString().slice(0, 10),
        license: 'public domain (work of the US federal government)',
      },
      null,
      2,
    ),
  );
  console.log(
    '\nFRICTION-LOG A8: an ammunition data sheet prints propellant type and charge weight.\n' +
      'SPEC.md §14 puts that outside the line, the schema has no field for it, and it must not\n' +
      'reach a sourceNote either.',
  );
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'list') await cmdList();
  else if (command === 'check') await cmdCheck();
  else if (command === 'find') await cmdFind(args.join(' '));
  else {
    console.error('usage: manuals.mjs list | check | find "FM 3-22.9"');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
