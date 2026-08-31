#!/usr/bin/env node
/**
 * Wikidata — the permanent join key, native names and aliases.
 *
 *   node scripts/data/wikidata.mjs id     "AK-47"
 *   node scripts/data/wikidata.mjs show   Q37116
 *   node scripts/data/wikidata.mjs native Q37116 russia
 *   node scripts/data/wikidata.mjs cite   Q37116
 *
 * SPEC.md Appendix A settles what this is for, and the wording is deliberate:
 * **join key, not master list.** Verified 2026-08-26 by SPARQL — `firearm
 * model` (Q22704163) holds ~668 items and the `firearm` (Q12796) subclass tree
 * returns ~402 dominated by museum-artefact properties. The coverage plan comes
 * from Wikipedia list articles instead (`plan.mjs`).
 *
 * What it *is* good for, and what this script prints:
 *  - `wikidataId`, stable across renames and article merges;
 *  - `nativeName` in the original script — the reason `Автомат Калашникова`
 *    can be on the AK-47 page at all;
 *  - aliases, which drive a large share of real search traffic (Pagefind found
 *    the pilot entries by `P80`, `SS109`, `Pulemyot` and `Wingmaster`).
 *
 * FRICTION-LOG A7 is the standing warning, printed by `show`: **Wikidata is one
 * item per family, not per model.** The PKM has no item of its own (Q159495 is
 * "PK"); Izhmash and Kalashnikov Concern share Q7427495; 12 gauge has no
 * cartridge item at all. Leaving `wikidataId` absent is correct in those cases.
 * Putting the family's id on a model is a wrong join that nothing detects.
 */
import { getJson, withQuery } from './lib/http.mjs';

const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const EN = 'https://en.wikipedia.org/w/api.php';

/**
 * The language a country's own literature is written in.
 *
 * Used only to *suggest* which label to read as `nativeName`, and every
 * suggestion is printed with its language code so the author confirms it. It is
 * not a mapping the schema knows about: `nativeName` is deliberately
 * unconstrained (primitives.ts) because the point is that the name is stored as
 * written, not transliterated into something searchable-but-wrong.
 */
const NATIVE_LANGS = {
  argentina: ['es'], austria: ['de'], 'austria-hungary': ['de', 'hu'], belgium: ['fr', 'nl'],
  brazil: ['pt'], china: ['zh'], croatia: ['hr'], czechia: ['cs'], czechoslovakia: ['cs', 'sk'],
  denmark: ['da'], egypt: ['ar'], finland: ['fi'], france: ['fr'], 'german-empire': ['de'],
  germany: ['de'], 'east-germany': ['de'], 'west-germany': ['de'], greece: ['el'],
  hungary: ['hu'], india: ['hi'], iran: ['fa'], israel: ['he'], italy: ['it'], japan: ['ja'],
  'north-korea': ['ko'], 'south-korea': ['ko'], mexico: ['es'], netherlands: ['nl'],
  norway: ['no', 'nb'], pakistan: ['ur'], poland: ['pl'], portugal: ['pt'], romania: ['ro'],
  russia: ['ru'], serbia: ['sr'], 'soviet-union': ['ru'], spain: ['es'], sweden: ['sv'],
  switzerland: ['de', 'fr'], taiwan: ['zh'], turkey: ['tr'], ukraine: ['uk'],
  yugoslavia: ['sr', 'hr'],
};

/** Claims worth reading for an arm or a cartridge, with what each is a lead for. */
const CLAIMS = {
  P176: 'manufacturer → makerRef (one primary; the rest are licensed production, i.e. lineage)',
  P287: 'designed by',
  P495: 'country of origin → designedIn',
  P17: 'country',
  P571: 'inception → introduced (CHECK: design year and service adoption differ)',
  P279: 'subclass of → a lead for `type`, never the term itself',
  P31: 'instance of — "firearm model" here means a model; "firearm" often means an artefact',
  P373: 'Commons category → image.mjs cat "<value>"',
  P1092: 'total produced',
  P729: 'service entry',
  P730: 'service retirement',
};

async function qidForTitle(title) {
  const data = await getJson(
    withQuery(EN, {
      action: 'query',
      prop: 'pageprops',
      titles: title,
      redirects: '1',
      format: 'json',
      formatversion: '2',
    }),
  );
  const page = data.query?.pages?.[0];
  return {
    qid: page?.pageprops?.wikibase_item ?? null,
    resolvedTitle: page?.title ?? title,
  };
}

async function entity(qid) {
  const data = await getJson(
    withQuery(WIKIDATA, {
      action: 'wbgetentities',
      ids: qid,
      props: 'labels|aliases|claims|descriptions',
      format: 'json',
      formatversion: '2',
    }),
  );
  const found = data.entities?.[qid];
  if (!found || found.missing !== undefined) throw new Error(`${qid} does not exist on Wikidata`);
  return found;
}

/** The plain value of a claim, whatever datatype it is. Null when it is not one we render. */
function claimValue(snak) {
  const value = snak?.datavalue?.value;
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  if (value['entity-type'] === 'item') return value.id;
  if (value.time) return String(value.time).replace(/^\+/, '').slice(0, 10);
  if (value.amount !== undefined) return String(value.amount).replace(/^\+/, '');
  return null;
}

/** Resolves item ids to labels so a claim reads as a name rather than as Q-numbers. */
async function labelsFor(ids) {
  const out = new Map();
  const unique = [...new Set(ids)].filter((id) => /^Q\d+$/.test(id));
  for (let i = 0; i < unique.length; i += 45) {
    const chunk = unique.slice(i, i + 45);
    const data = await getJson(
      withQuery(WIKIDATA, {
        action: 'wbgetentities',
        ids: chunk.join('|'),
        props: 'labels',
        languages: 'en',
        format: 'json',
        formatversion: '2',
      }),
    );
    for (const [id, item] of Object.entries(data.entities ?? {})) {
      out.set(id, item.labels?.en?.value ?? id);
    }
  }
  return out;
}

async function cmdId(title) {
  const { qid, resolvedTitle } = await qidForTitle(title);
  console.log(`${title} → ${resolvedTitle}`);
  console.log(`wikidataId: ${qid ?? '(none — leave the field absent, FRICTION-LOG A7)'}`);
}

async function cmdShow(qid) {
  const item = await entity(qid);
  console.log(`# ${qid} — ${item.labels?.en?.value ?? '(no English label)'}`);
  if (item.descriptions?.en) console.log(`  ${item.descriptions.en.value}`);
  console.log('');

  const claimIds = [];
  for (const [property, meaning] of Object.entries(CLAIMS)) {
    const claims = item.claims?.[property] ?? [];
    for (const claim of claims) {
      const value = claimValue(claim.mainsnak);
      if (value) claimIds.push(value);
    }
    if (claims.length) console.log(`${property}  ${meaning}`);
  }
  const labels = await labelsFor(claimIds);
  console.log('');
  for (const property of Object.keys(CLAIMS)) {
    for (const claim of item.claims?.[property] ?? []) {
      const value = claimValue(claim.mainsnak);
      if (!value) continue;
      const rank = claim.rank === 'deprecated' ? '  [DEPRECATED — do not use]' : '';
      console.log(`${property.padEnd(7)} ${labels.get(value) ?? value}${value.startsWith?.('Q') ? ` (${value})` : ''}${rank}`);
    }
  }

  const aliases = (item.aliases?.en ?? []).map((a) => a.value);
  if (aliases.length) console.log(`\nEnglish aliases: ${aliases.join(' · ')}`);

  console.log(
    '\nFRICTION-LOG A7 — CHECK THIS ITEM IS THE MODEL, NOT THE FAMILY. Wikidata has one item\n' +
      'per family far more often than per model: Q159495 is "PK", not the PKM, and Izhmash\n' +
      'shares Q7427495 with Kalashnikov Concern. If this item is the family, leave\n' +
      '`wikidataId` absent on the model rather than recording a wrong join.',
  );
}

async function cmdNative(qid, country) {
  const item = await entity(qid);
  const langs = country ? NATIVE_LANGS[country] : null;
  if (country && !langs) {
    console.error(
      `no native language recorded for "${country}". Known: ${Object.keys(NATIVE_LANGS).join(', ')}`,
    );
  }

  console.log(`# ${qid} — ${item.labels?.en?.value ?? qid}\n`);
  if (langs) {
    console.log(`labels in the language(s) of ${country}:`);
    for (const lang of langs) {
      const label = item.labels?.[lang]?.value;
      console.log(`  ${lang}: ${label ?? '(no label in this language)'}`);
    }
    const chosen = langs.map((l) => item.labels?.[l]?.value).find(Boolean);
    if (chosen) {
      console.log(`\nnativeName candidate (CONFIRM the script is right before using it):`);
      console.log(JSON.stringify({ nativeName: chosen }, null, 2));
    }
    console.log('');
  }

  const seen = new Set([item.labels?.en?.value]);
  const rows = [];
  for (const alias of item.aliases?.en ?? []) {
    if (seen.has(alias.value)) continue;
    seen.add(alias.value);
    rows.push(alias.value);
  }
  for (const lang of langs ?? []) {
    for (const alias of item.aliases?.[lang] ?? []) {
      if (seen.has(alias.value)) continue;
      seen.add(alias.value);
      rows.push(alias.value);
    }
  }
  console.log(`aliases (${rows.length}) — each needs a kind and, where it applies, a market:`);
  for (const row of rows) console.log(`  ${row}`);
  console.log(
    '\n`aliases[]` takes {name, kind, market?, years?}. Wikidata does not record which of these\n' +
      'is a military designation, an export name or a trade name, so the kind is a judgement:\n' +
      'record only the ones you can attribute, and drop spelling variants — they are not aliases.',
  );
}

async function cmdCite(qid) {
  const item = await entity(qid);
  console.log(
    JSON.stringify(
      {
        key: `wd-${qid.toLowerCase()}`,
        type: 'wikidata',
        title: item.labels?.en?.value ?? qid,
        publisher: 'Wikidata',
        url: `https://www.wikidata.org/wiki/${qid}`,
        accessed: new Date().toISOString().slice(0, 10),
        license: 'CC0 1.0',
      },
      null,
      2,
    ),
  );
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'id') await cmdId(args[0]);
  else if (command === 'show') await cmdShow(args[0]);
  else if (command === 'native') await cmdNative(args[0], args[1]);
  else if (command === 'cite') await cmdCite(args[0]);
  else {
    console.error(
      'usage: wikidata.mjs id "Article title" | show Q37116 | native Q37116 <country-term> | cite Q37116',
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
