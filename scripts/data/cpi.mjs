#!/usr/bin/env node
/**
 * Bakes `src/data/cpi.json` — the inflation table, fetched once and committed.
 *
 *   node scripts/data/cpi.mjs
 *   node scripts/data/cpi.mjs --check     # compare the live series to the file
 *
 * SPEC.md Appendix A: **the built site makes no runtime API call.** A price
 * page that fetches the CPI at render time is a page that breaks when the BLS
 * changes an endpoint, and a static site has no server to do it on anyway. So
 * the table is baked, and `lib/math/economics.ts` takes it as a parameter
 * because `lib/math` does no I/O at all (Instruction.md Phase 3).
 *
 * Series `CUUR0000SA0` — CPI for All Urban Consumers, US city average, all
 * items, not seasonally adjusted, base 1982-84 = 100. Period `M13` is the
 * annual average, which is the right figure for "what was $30 in 1955 worth":
 * a launch price is a price over a year, not on a day.
 *
 * The public API v1 needs no key, takes at most ten years per request and
 * allows 25 requests a day. 1913 to now is twelve requests. Run it once a year.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { postJson } from './lib/http.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT = path.join(REPO_ROOT, 'src', 'data', 'cpi.json');

const SERIES = 'CUUR0000SA0';
const API = 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
const FIRST_YEAR = 1913;

async function fetchAnnualAverages() {
  const now = new Date().getUTCFullYear();
  const values = {};
  for (let start = FIRST_YEAR; start <= now; start += 10) {
    const end = Math.min(start + 9, now);
    const data = await postJson(API, {
      seriesid: [SERIES],
      startyear: String(start),
      endyear: String(end),
      annualaverage: true,
    });
    if (data.status !== 'REQUEST_SUCCEEDED') {
      throw new Error(`BLS ${start}-${end}: ${data.status} ${(data.message ?? []).join('; ')}`);
    }
    const rows = data.Results?.series?.[0]?.data ?? [];
    for (const row of rows) {
      // M13 is the annual average. Every other period is a month, and mixing a
      // December value into a table of annual averages would put a silent
      // seasonal error into every adjusted price for that year.
      if (row.period !== 'M13') continue;
      const value = Number(row.value);
      if (Number.isFinite(value)) values[row.year] = value;
    }
    console.error(`${start}–${end}: ${rows.filter((r) => r.period === 'M13').length} annual average(s)`);
  }
  return values;
}

function envelope(values) {
  const years = Object.keys(values).map(Number).sort((a, b) => a - b);
  return {
    note:
      'Annual-average CPI-U, baked at authoring time so the built site makes no runtime API call ' +
      '(SPEC.md Appendix A). `lib/math/economics.ts` takes `annualAverage` as its `CpiTable` and ' +
      'returns null — not an approximation — for a year that is absent. The current year has no ' +
      'annual average until the year is over, which is why the table normally stops one year back. ' +
      'Regenerate with `node scripts/data/cpi.mjs`.',
    series: SERIES,
    seriesTitle:
      'Consumer Price Index for All Urban Consumers (CPI-U), US city average, all items, not seasonally adjusted',
    period: 'M13 — annual average',
    base: '1982-84 = 100',
    publisher: 'US Bureau of Labor Statistics',
    sourceUrl: 'https://www.bls.gov/cpi/',
    api: API,
    accessed: new Date().toISOString().slice(0, 10),
    firstYear: years[0],
    lastYear: years[years.length - 1],
    // Firearms are not a CPI basket category. This says what the money was
    // worth, not what the market did — economics.ts carries the same sentence
    // as an assumption on every adjusted figure, and the page repeats it.
    caveat:
      'General consumer price inflation. Firearms are not a CPI basket category, so an adjusted launch price says what the money was worth, not what the arm is worth.',
    annualAverage: Object.fromEntries(years.map((year) => [String(year), values[year]])),
  };
}

async function cmdBake() {
  const values = await fetchAnnualAverages();
  const count = Object.keys(values).length;
  if (count < 100) {
    throw new Error(
      `only ${count} annual averages came back; expected one per year from ${FIRST_YEAR}. ` +
        'Writing a partial table would make adjustForInflation return null for real years, which ' +
        'reads as "we cannot know" rather than "the fetch failed".',
    );
  }
  const built = envelope(values);
  await writeFile(OUT, `${JSON.stringify(built, null, 2)}\n`, 'utf8');
  console.error(
    `\nwrote ${path.relative(REPO_ROOT, OUT)} — ${count} years, ${built.firstYear}–${built.lastYear}`,
  );
  console.error(
    `1913 = ${built.annualAverage['1913']}, ${built.lastYear} = ${built.annualAverage[String(built.lastYear)]} ` +
      `(a 1913 dollar is ${(built.annualAverage[String(built.lastYear)] / built.annualAverage['1913']).toFixed(1)}× ${built.lastYear} dollars).`,
  );
}

async function cmdCheck() {
  const existing = JSON.parse(await readFile(OUT, 'utf8'));
  const values = await fetchAnnualAverages();
  const differences = [];
  for (const [year, value] of Object.entries(values)) {
    const was = existing.annualAverage[year];
    if (was === undefined) differences.push(`${year}: absent locally, ${value} live`);
    else if (Math.abs(was - value) > 1e-9) differences.push(`${year}: ${was} local vs ${value} live`);
  }
  if (differences.length === 0) {
    console.log(`[cpi] up to date — ${Object.keys(values).length} years match.`);
    return;
  }
  // BLS does revise. A changed figure is not an error, it is a reason to rebake.
  console.log(`${differences.length} difference(s):`);
  for (const line of differences) console.log(`  ${line}`);
  process.exitCode = 1;
}

try {
  if (process.argv.includes('--check')) await cmdCheck();
  else await cmdBake();
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
