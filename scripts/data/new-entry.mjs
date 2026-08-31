#!/usr/bin/env node
/**
 * Scaffolds the two files an entry is made of, and the citation that proves it.
 *
 *   node scripts/data/new-entry.mjs gun       type-63 "Type 63 assault rifle"
 *   node scripts/data/new-entry.mjs cartridge 30-06-springfield ".30-06 Springfield"
 *
 * Instruction.md Phase 9's definition of done is that **a second author can
 * produce an entry meaningfully faster than Phase 8 did**. Phase 8 measured
 * itself at ~25 minutes of sourcing plus ~10 of writing per entry
 * (FRICTION-LOG E1), and the writing half is what this removes: the shape of
 * the two files, the identity fields, the Wikipedia permalink citation, and the
 * checklist of what still has to be found.
 *
 * **It fabricates nothing.** Every measured field is written as
 * `status: 'placeholder'` with `value: null`, which is the one status the
 * schema pins to a null value precisely so that an unfilled figure cannot
 * masquerade as a real one (primitives.ts). Every judgement — type, action,
 * operating system, country — is written as `TODO`, which fails the taxonomy
 * gate by design and fails it with the whole vocabulary in the message.
 *
 * So a fresh scaffold **does not pass `check:content`, and that is the point**:
 * the build tells the author exactly which decisions are outstanding, by field,
 * and stops telling them the moment the entry is real. A scaffold that passed
 * would be the green build nobody is testing.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getJson, withQuery } from './lib/http.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const EN = 'https://en.wikipedia.org/w/api.php';
const TODAY = new Date().toISOString().slice(0, 10);

const placeholder = (unit) => ({
  value: null,
  unit,
  status: 'placeholder',
  sourceNote: 'TODO — find it, or delete this field. An absent field is an honest gap.',
});

async function article(title) {
  const data = await getJson(
    withQuery(EN, {
      action: 'query',
      prop: 'info|pageprops',
      titles: title,
      redirects: '1',
      inprop: 'url',
      ppprop: 'wikibase_item',
      format: 'json',
      formatversion: '2',
    }),
  );
  const page = data.query?.pages?.[0];
  if (!page || page.missing) throw new Error(`"${title}" does not exist on en.wikipedia.org`);
  return {
    title: page.title,
    revid: String(page.lastrevid),
    wikidataId: page.pageprops?.wikibase_item ?? null,
    redirected: page.title !== title,
  };
}

function wikipediaReference(found) {
  return {
    key: `wp-${found.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    type: 'wikipedia',
    title: found.title,
    publisher: 'Wikipedia',
    // FRICTION-LOG A6: the permalink. A revid typed later is a fabrication, so
    // it is taken from the same call that resolved the title.
    url: `https://en.wikipedia.org/w/index.php?oldid=${found.revid}`,
    lang: 'en',
    revision: found.revid,
    accessed: TODAY,
    license: 'CC BY-SA 4.0',
  };
}

function gunData(slug, found) {
  return {
    id: slug,
    name: found.title,
    kind: 'model',
    // FRICTION-LOG A7: Wikidata is one item per family far more often than per
    // model. If this id turns out to be the family's, delete the field — a
    // wrong join is worse than a missing one.
    ...(found.wikidataId ? { wikidataId: found.wikidataId } : {}),
    makerRef: 'TODO',
    familyRef: null,
    alsoInFamilies: [],
    aliases: [],
    lineage: {},
    // Every one of these fails the taxonomy gate, and the failure message lists
    // the whole vocabulary — so the build error IS the reference an author needs,
    // at the moment they need it. `check:content` takes about a second.
    type: 'TODO',
    action: 'TODO',
    operatingSystem: 'TODO',
    designedIn: 'TODO',
    producedIn: [],
    fireModes: [],
    feedSystem: [],
    roles: [],
    // `introduced` and `productionYears` are omitted rather than zeroed: a zero
    // year produces a range error that says nothing useful, and both fields are
    // optional, so an absent one is already the honest state.
    massEmpty: placeholder('kg'),
    length: placeholder('mm'),
    barrelLength: placeholder('mm'),
    chamberings: [
      {
        cartridgeRef: 'TODO',
        capacity: placeholder(''),
        primary: true,
      },
    ],
    variants: [],
    fits: [],
    images: [],
    lastVerified: TODAY,
    reviewStatus: 'draft',
    references: [wikipediaReference(found)],
  };
}

function cartridgeData(slug, found) {
  return {
    id: slug,
    name: found.title,
    ...(found.wikidataId ? { wikidataId: found.wikidataId } : {}),
    aliases: [],
    // As above: each fails with the full vocabulary in the message. A cartridge
    // has no `designedIn` — origin is `designedBy`, free text, because it is
    // usually a person (Georg Luger) rather than a country.
    caseType: 'TODO',
    standard: 'TODO',
    // `introduced` is omitted on purpose — FRICTION-LOG B2: 12 gauge has no
    // publishable introduction year, and a required field guaranteed an invented
    // one on exactly the entries nobody could check.
    caseLength: placeholder('mm'),
    overallLength: placeholder('mm'),
    bulletDiameter: placeholder('mm'),
    loads: [],
    images: [],
    lastVerified: TODAY,
    reviewStatus: 'draft',
    references: [wikipediaReference(found)],
  };
}

const GUN_MDX = (slug, found) => `---
id: ${slug}
name: ${JSON.stringify(found.title)}
kind: model
makerRef: TODO
familyRef: null
---

TODO — the narrative. Not a spec table in prose: the table is next to it and repeating it wastes
the reader's attention. Say what the design does that the numbers do not, what it was answering,
and where it sits against what came before.

TODO — FRICTION-LOG E4: end with a paragraph naming this entry's own gaps. No published twist
rate, no free dimensional standard, no photograph of this exact variant. That paragraph is what
makes the amber badges legible to a reader who does not know what a status field is, and it
reads far better than a page of unexplained warnings.
`;

const CARTRIDGE_MDX = (slug, found) => `---
id: ${slug}
name: ${JSON.stringify(found.title)}
---

TODO — the narrative. What problem this cartridge was designed against, what it displaced, and
what its dimensions imply for the arms built around it.

TODO — FRICTION-LOG E4: end with a paragraph naming this entry's own gaps.
`;

const CHECKLIST = {
  gun: [
    'wiki.mjs infobox "<title>"     — the leads, with the refs that back each one',
    'wiki.mjs refs "<title>" weight — the source that can actually carry `verified`',
    'wikidata.mjs native <QID> <country> — nativeName and aliases',
    'spec.mjs read "<maker product url>"  — then follow any spec-sheet PDF',
    'manuals.mjs list               — for a service arm, this beats every other source',
    'image.mjs find "<title>"       — then `image.mjs add <file> guns/<slug> hero`',
  ],
  cartridge: [
    'wiki.mjs infobox "<title>"     — note the unit regime banner; the bare numbers are not all SI',
    'wiki.mjs loads "<title>"       — and read the test-barrel warning before recording any velocity',
    'cip.mjs find "<name>"          — dimensions and Pmax, free',
    'cip.mjs sheet "<name>"         — the six cartridge dimensions, section-aware',
    'image.mjs find "<title>"',
  ],
};

async function main() {
  const [kind, slug, ...rest] = process.argv.slice(2);
  const title = rest.join(' ');
  if (!['gun', 'cartridge'].includes(kind) || !slug || !title) {
    throw new Error('usage: new-entry.mjs <gun|cartridge> <slug> "<Wikipedia article title>"');
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`"${slug}" is not a lowercase kebab-case slug`);
  }

  const found = await article(title);
  const isGun = kind === 'gun';
  const narrativeDir = path.join(REPO_ROOT, 'src', 'content', isGun ? 'guns' : 'cartridges');
  const dataDir = path.join(REPO_ROOT, 'src', 'content', isGun ? 'gunData' : 'cartridgeData');
  const narrativePath = path.join(narrativeDir, `${slug}.mdx`);
  const dataPath = path.join(dataDir, `${slug}.json`);

  for (const file of [narrativePath, dataPath]) {
    // Never overwrite. An author re-running this on a half-finished entry would
    // otherwise lose an afternoon of sourcing to a command that looked harmless.
    const exists = await readFile(file, 'utf8').catch(() => null);
    if (exists !== null) throw new Error(`${path.relative(REPO_ROOT, file)} already exists — refusing to overwrite`);
  }

  await mkdir(narrativeDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    narrativePath,
    isGun ? GUN_MDX(slug, found) : CARTRIDGE_MDX(slug, found),
    'utf8',
  );
  await writeFile(
    dataPath,
    `${JSON.stringify(isGun ? gunData(slug, found) : cartridgeData(slug, found), null, 2)}\n`,
    'utf8',
  );

  console.log(`wrote ${path.relative(REPO_ROOT, narrativePath).replace(/\\/g, '/')}`);
  console.log(`wrote ${path.relative(REPO_ROOT, dataPath).replace(/\\/g, '/')}`);
  if (found.redirected) console.log(`\nnote: "${title}" redirected to "${found.title}" — cite the latter.`);
  console.log(`\nwikidataId: ${found.wikidataId ?? '(none — the field was left out, which is correct)'}`);
  console.log(`Wikipedia permalink cited at revision ${found.revid}.`);

  console.log('\nnext:');
  for (const line of CHECKLIST[kind]) console.log(`  node scripts/data/${line}`);
  console.log(
    '\n`npm run check:content` will fail until every TODO is resolved. That is the checklist:\n' +
      'it names the outstanding field, not the outstanding entry. Every measured field is a\n' +
      "`placeholder` with a null value — delete the ones you cannot source; don't fill them in.",
  );
}

try {
  await main();
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
