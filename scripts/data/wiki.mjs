#!/usr/bin/env node
/**
 * Wikipedia fetcher for the authoring pipeline.
 *
 *   node scripts/data/wiki.mjs infobox "AK-47"
 *   node scripts/data/wiki.mjs loads   "9×19mm Parabellum"
 *   node scripts/data/wiki.mjs refs    "AK-47" weight
 *   node scripts/data/wiki.mjs cite    "AK-47"
 *   node scripts/data/wiki.mjs raw     "AK-47" > article.wikitext
 *   node scripts/data/wiki.mjs grep    "AK-47" "twist|rifling|chrome"
 *
 * Two rules from the Phase 8 friction log are built in rather than written down:
 *
 *  - **A6: cite by permalink, never by title.** `cite` emits `?oldid=<revid>`
 *    with the revid fetched in the same call as the content, because a revid
 *    typed later is a fabrication. `redirects=1` is always on: "Glock 17"
 *    redirects to "Glock" and "Mauser 98" to "Gewehr 98", and without it the
 *    API hands back the *redirect page's* revid, which is years stale.
 *  - **The infobox is a first pass (SPEC.md Appendix A), so show what backs
 *    it.** `refs` prints the `<ref>` tags attached to a field. Those refs are
 *    usually the manual or manufacturer sheet the figure actually came from —
 *    i.e. a source that can carry `verified`, where Wikipedia alone is a lead.
 */
import {
  armsInfobox,
  fieldReferences,
  infoboxFields,
  infoboxName,
  plain,
  readField,
  toSi,
  GLOSSARY,
} from './lib/wikitext.mjs';
import { getJson, withQuery } from './lib/http.mjs';

/** Wikitext of an article plus the revision it was read at. */
export async function fetchArticle(title, lang = 'en') {
  const api = `https://${lang}.wikipedia.org/w/api.php`;
  const data = await getJson(
    withQuery(api, {
      action: 'parse',
      page: title,
      prop: 'wikitext|revid',
      redirects: '1',
      format: 'json',
      formatversion: '2',
    }),
  );
  if (data.error) throw new Error(`${title}: ${data.error.info}`);
  return {
    title: data.parse.title,
    revid: String(data.parse.revid),
    wikitext: data.parse.wikitext,
    lang,
    requested: title,
  };
}

/** `{{Infobox weapon}}` fields, in the order a gun entry wants them. */
const WEAPON_FIELDS = [
  'name', 'origin', 'type', 'designer', 'design_date', 'manufacturer', 'production_date',
  'number', 'service', 'used_by', 'variants', 'spec_label',
  'weight', 'length', 'part_length', 'width', 'height',
  'cartridge', 'caliber', 'action', 'rate', 'velocity', 'range', 'max_range',
  'feed', 'sights',
];

/** `{{Infobox firearm cartridge}}` fields, in the order a cartridge entry wants them. */
const CARTRIDGE_FIELDS = [
  'name', 'origin', 'type', 'designer', 'design_date', 'manufacturer', 'production_date',
  'service', 'parent', 'case_type', 'bullet', 'neck', 'shoulder', 'base', 'rim_dia',
  'rim_thick', 'case_length', 'length', 'rifling', 'primer', 'max_pressure', 'max_cup',
  'test_barrel_length', 'balsrc',
];

/** The schema field a Wikipedia infobox field is a lead for. Blank where there is none. */
const MAPS_TO = {
  weight: 'massEmpty — CHECK whether the source means with or without magazine',
  length: 'length (overall). Several values here means several stock configurations',
  part_length: 'barrelLength',
  width: 'width',
  height: 'height',
  velocity: 'a cartridgeLoad velocity point — USELESS without a barrel length (FRICTION-LOG A5)',
  rate: 'cyclicRate — almost always a published RANGE, which PropertyValue cannot hold (B3)',
  sights: 'sightRadius, if it states one',
  cartridge: 'chamberings[].cartridgeRef',
  feed: 'feedSystem[] and chamberings[].capacity',
  action: 'action + operatingSystem — two schema fields, one infobox line',
  origin: 'designedIn',
  manufacturer: 'makerRef — one primary maker, the rest are licensed production (lineage)',
  case_length: 'caseLength',
  bullet: 'bulletDiameter (or boreDiameter for a shotshell — B1)',
  rim_dia: 'rimDiameter',
  base: 'baseDiameter',
  neck: 'neckDiameter',
  length_cartridge: 'overallLength',
  max_pressure: 'maxPressure — check the unit, psi/bar/MPa all appear',
  test_barrel_length: 'THE field that makes a velocity usable at all (FRICTION-LOG A5)',
};

function describe(entry) {
  if (entry.values === null) return entry.text;
  const si = toSi(entry.values[0], entry.unit ?? '');
  const range = entry.values.length > 1 ? `${entry.values[0]}–${entry.values[1]}` : `${entry.values[0]}`;
  const converted = si && si.factor !== 1 ? `  →  ${Number(si.value.toFixed(4))} ${si.unit}` : '';
  const qualifier = entry.qualifier ? `  [${entry.qualifier.replace(/\n/g, ' / ')}]` : '';
  const flags =
    (entry.values.length > 1 ? '  ⚠ RANGE — PropertyValue holds one number (FRICTION-LOG B3)' : '') +
    (entry.bare ? '  ⚠ bare number, no {{convert}} — re-read the article text' : '');
  return `${range} ${entry.unit ?? ''}${converted}${qualifier}${flags}`;
}

function printField(fields, field, box) {
  const entries = readField(fields, field);
  if (entries.length === 0) return;
  const target = MAPS_TO[field];
  const refs = fieldReferences(box, field);
  const label = `${field}${target ? '' : ''}`;
  if (entries.length === 1) {
    console.log(`${label.padEnd(20)} ${describe(entries[0])}`);
  } else {
    console.log(`${label.padEnd(20)} (${entries.length} values)`);
    for (const entry of entries) console.log(`${' '.repeat(22)}${describe(entry)}`);
  }
  if (target) console.log(`${' '.repeat(22)}→ ${target}`);
  for (const url of refs.urls.slice(0, 4)) console.log(`${' '.repeat(22)}cited: ${url}`);
}

async function cmdInfobox(title, lang) {
  const article = await fetchArticle(title, lang);
  const box = armsInfobox(article.wikitext);
  if (!box) {
    console.error(`No arms infobox found in "${article.title}".`);
    process.exitCode = 1;
    return;
  }
  const kind = infoboxName(box);
  const fields = infoboxFields(box);
  console.log(`# ${article.title}  (revision ${article.revid}, ${kind})`);
  if (article.title !== article.requested) {
    console.log(`  NOTE: "${article.requested}" redirected here. Cite THIS title.`);
  }
  console.log('');

  const isCartridge = /cartridge|ammunition/.test(kind ?? '');
  if (isCartridge) console.log(`${unitRegime(fields).banner}\n`);
  const known = isCartridge ? CARTRIDGE_FIELDS : WEAPON_FIELDS;
  for (const field of known) printField(fields, field, box);

  const other = Object.keys(fields).filter((f) => !known.includes(f) && fields[f]);
  if (other.length) {
    console.log(`\n--- other fields present in this infobox ---`);
    for (const field of other) printField(fields, field, box);
  }

  if (lang !== 'en' && GLOSSARY[lang]) {
    console.log(`\n--- ${lang} terms that are easy to misread ---`);
    for (const [term, meaning] of Object.entries(GLOSSARY[lang])) {
      console.log(`  ${term.padEnd(28)} ${meaning}`);
    }
    console.log(
      '\nNUMBERS: this edition may write 1.234,5 for one thousand two hundred thirty-four point five.\n' +
        'Use parseLocalisedNumber() from lib/wikitext.mjs — a bare "1.200" is ambiguous and it says so.',
    );
  }

  console.log(
    '\nSPEC.md Appendix A: an infobox is a FIRST PASS. Every "cited:" line above is a lead to\n' +
      'the source that can actually carry `verified`. Run `wiki.mjs refs "<title>" <field>` for the rest.',
  );
}

/**
 * Which units the bare numbers in `{{Infobox firearm cartridge}}` are in.
 *
 * This template writes its dimensions as bare numbers and puts the unit system
 * in a *separate* switch: `is_SI_specs = yes` means `bullet = 9.01` is
 * millimetres and `max_pressure = 235.00` is MPa; without it the same fields
 * are inches and psi. `bwunit = gram` does the same job for bullet mass and
 * defaults to grains.
 *
 * Reading `bullet = 0.355` as millimetres instead of inches gives a projectile
 * a third of a millimetre across — absurd to a person and perfectly acceptable
 * to the schema, which is the failure class SPEC.md §5.8 exists to prevent. So
 * the regime is printed as a banner rather than assumed.
 */
function unitRegime(fields) {
  const si = /^(yes|y|true|1)$/i.test((fields.is_si_specs ?? '').trim());
  const massUnit = /gram|g\b/i.test(fields.bwunit ?? '') ? 'g' : 'gr';
  return {
    si,
    massUnit,
    lengthUnit: si ? 'mm' : 'in',
    pressureUnit: si ? 'MPa' : 'psi',
    banner:
      `UNIT REGIME: is_SI_specs=${si ? 'yes' : 'no/absent'} → bare dimensions are ${si ? 'mm' : 'INCHES'}, ` +
      `pressure is ${si ? 'MPa' : 'psi'}; bwunit=${fields.bwunit ?? '(absent)'} → bullet mass is ${
        massUnit === 'g' ? 'grams' : 'GRAINS'
      }.\n` +
      '             Velocity and energy carry NO unit switch in this template — see `wiki.mjs loads`.',
  };
}

/**
 * The per-load ballistics table on a cartridge article.
 *
 * Broken out from `infobox` because these fields are numbered (`bw1`, `vel1`,
 * `en1`, …) and printing them as twenty unrelated lines hides two things:
 *
 *  - **The whole table is governed by one `test_barrel_length`, and without it
 *    none of it is usable** (FRICTION-LOG A5, SPEC.md §8.2).
 *  - **`vel` and `en` have no unit parameter at all.** The 9×19mm article sets
 *    `bwunit = gram` and then writes velocity in ft/s and energy in ft·lbf on
 *    the same rows. Nothing in the template says so.
 *
 * The second is not guessed. Energy is `½mv²`, so the published energy and the
 * published velocity are only self-consistent under one interpretation of the
 * velocity unit — and testing both against the arithmetic is a derivation from
 * the data, not an assumption about the template.
 */
async function cmdLoads(title, lang) {
  const article = await fetchArticle(title, lang);
  const box = armsInfobox(article.wikitext);
  if (!box) throw new Error(`no infobox in "${article.title}"`);
  const fields = infoboxFields(box);
  const regime = unitRegime(fields);

  console.log(`# ${article.title}  (revision ${article.revid})\n`);
  console.log(`${regime.banner}\n`);

  const barrel = readField(fields, 'test_barrel_length')[0];
  if (barrel) {
    console.log(`test barrel : ${describe(barrel)}`);
    console.log(
      '              Read this carefully — an article often lists a second barrel for one\n' +
        '              maker only, and the velocity rows do not say which one they belong to.',
    );
  } else {
    console.log(
      'test barrel : NOT STATED.\n' +
        '  Every velocity below is therefore unusable as a cartridgeLoad point. FRICTION-LOG A5:\n' +
        '  a velocity point requires a barrel length stated by a source; where none is stated,\n' +
        '  there is no point. Record the bullet mass and the ballistic coefficient, and leave\n' +
        '  velocity absent — that is an honest load, not an incomplete one.',
    );
  }
  const source = readField(fields, 'balsrc')[0];
  if (source) console.log(`ballistics source: ${source.text}`);
  console.log('');

  const GRAIN_G = 0.06479891;
  const FTLBF_J = 1.3558179483314004;
  const FTS_MS = 0.3048;

  for (let i = 1; i <= 12; i += 1) {
    const raw = fields[`bw${i}`];
    if (!raw) continue;
    const mass = Number(String(raw).trim());
    const velocity = Number(String(fields[`vel${i}`] ?? '').trim());
    const energy = Number(String(fields[`en${i}`] ?? '').trim());
    const type = plain(fields[`btype${i}`] ?? '') || '(unnamed)';

    const massG = regime.massUnit === 'g' ? mass : mass * GRAIN_G;
    console.log(`load ${i}: ${type}`);
    console.log(
      `   mass     ${mass} ${regime.massUnit}  →  ${Number(massG.toFixed(4))} g` +
        (regime.massUnit === 'gr' ? `  (1 gr = ${GRAIN_G} g)` : ''),
    );

    if (!Number.isFinite(velocity)) {
      console.log('   velocity not stated');
      continue;
    }

    // Which velocity unit reproduces the published energy? Both are tried and
    // the arithmetic decides; nothing is assumed about the template.
    let verdict = null;
    if (Number.isFinite(energy) && massG > 0) {
      const joulesIf = (ms) => 0.5 * (massG / 1000) * ms * ms;
      const publishedJ = [
        { unit: 'ft·lbf', joules: energy * FTLBF_J },
        { unit: 'J', joules: energy },
      ];
      const candidates = [
        { unit: 'ft/s', ms: velocity * FTS_MS },
        { unit: 'm/s', ms: velocity },
      ];
      let best = null;
      for (const v of candidates) {
        for (const e of publishedJ) {
          const error = Math.abs(joulesIf(v.ms) - e.joules) / e.joules;
          if (!best || error < best.error) best = { ...v, energyUnit: e.unit, error };
        }
      }
      verdict = best;
    }

    if (verdict && verdict.error < 0.03) {
      console.log(
        `   velocity ${velocity} ${verdict.unit}  →  ${Number(verdict.ms.toFixed(2))} m/s` +
          `   [½mv² reproduces the published energy as ${verdict.energyUnit} to ${(verdict.error * 100).toFixed(1)}%]`,
      );
    } else if (verdict) {
      console.log(
        `   velocity ${velocity} — UNIT UNRESOLVED. Neither ft/s nor m/s reproduces the published\n` +
          `            energy ${energy} to better than ${(verdict.error * 100).toFixed(0)}%. Do not record either figure\n` +
          '            until the balsrc source is read directly.',
      );
    } else {
      console.log(
        `   velocity ${velocity} — no energy row to cross-check the unit against. Read balsrc.`,
      );
    }
    if (Number.isFinite(energy)) {
      console.log(`   energy   ${energy} — DERIVED, do not store it (SPEC.md §8.1)`);
    }
  }
  console.log(
    '\nEnergy is computed by lib/math/ballistics/energy.ts from mass and velocity. Storing a\n' +
      'published energy figure creates a second, drifting copy of a derived number.',
  );
}

async function cmdRefs(title, field, lang) {
  const article = await fetchArticle(title, lang);
  const box = armsInfobox(article.wikitext);
  if (!box) throw new Error(`no infobox in "${article.title}"`);
  const refs = fieldReferences(box, field);
  if (refs.raw.length === 0) {
    console.log(`"${field}" carries no inline citation in the infobox of ${article.title}.`);
    console.log('That figure is unsourced ON WIKIPEDIA. It is a lead, not a source.');
    return;
  }
  for (const [i, raw] of refs.raw.entries()) {
    console.log(`--- ref ${i + 1} ---`);
    console.log(plain(raw).slice(0, 800));
    console.log('');
  }
  if (refs.urls.length) {
    console.log('URLs:');
    for (const url of refs.urls) console.log(`  ${url}`);
  }
}

async function cmdCite(title, lang) {
  const article = await fetchArticle(title, lang);
  // The language belongs in the key, or the German and English articles for the
  // same arm generate the same key and the second silently overwrites the first.
  const prefix = article.lang === 'en' ? 'wp' : `wp-${article.lang}`;
  const key = `${prefix}-${article.title}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const entry = {
    key,
    type: 'wikipedia',
    title: article.title,
    publisher: 'Wikipedia',
    // FRICTION-LOG A6: the permalink, not the article URL. `?oldid=` is what
    // makes `revision` mean anything at all.
    url: `https://${article.lang}.wikipedia.org/w/index.php?oldid=${article.revid}`,
    lang: article.lang,
    revision: article.revid,
    accessed: new Date().toISOString().slice(0, 10),
    license: 'CC BY-SA 4.0',
  };
  console.log(JSON.stringify(entry, null, 2));
  if (article.title !== article.requested) {
    console.error(`note: "${article.requested}" redirected to "${article.title}".`);
  }
}

async function cmdRaw(title, lang) {
  const article = await fetchArticle(title, lang);
  process.stdout.write(article.wikitext);
}

async function cmdGrep(title, pattern, lang) {
  const article = await fetchArticle(title, lang);
  const re = new RegExp(pattern, 'i');
  let hits = 0;
  for (const [i, line] of article.wikitext.split('\n').entries()) {
    if (!re.test(line)) continue;
    hits += 1;
    const text = plain(line).slice(0, 600);
    if (text) console.log(`${String(i + 1).padStart(5)}  ${text}\n`);
  }
  console.error(`${hits} matching line(s) in ${article.title} (revision ${article.revid}).`);
}

const [command, ...rest] = process.argv.slice(2);
const langFlag = rest.findIndex((a) => a === '--lang');
const lang = langFlag === -1 ? 'en' : rest[langFlag + 1];
const args = langFlag === -1 ? rest : rest.filter((_, i) => i !== langFlag && i !== langFlag + 1);

try {
  if (command === 'infobox') await cmdInfobox(args[0], lang);
  else if (command === 'loads') await cmdLoads(args[0], lang);
  else if (command === 'refs') await cmdRefs(args[0], args[1], lang);
  else if (command === 'cite') await cmdCite(args[0], lang);
  else if (command === 'raw') await cmdRaw(args[0], lang);
  else if (command === 'grep') await cmdGrep(args[0], args[1], lang);
  else {
    console.error(
      'usage: wiki.mjs <infobox|loads|refs|cite|raw|grep> "Article title" [field|pattern] [--lang de]',
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
