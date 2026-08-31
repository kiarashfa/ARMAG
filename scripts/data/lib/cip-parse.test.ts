/**
 * The C.I.P. traps, held to tests. The fixture is the real extracted text of
 * the 9 mm Luger datasheet, trimmed — including its awkward last line, which
 * is what broke the section split the first time.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CARTRIDGE_DIMENSIONS,
  cipNumber,
  normaliseName,
  parseDatasheet,
  parseIndex,
  searchIndex,
} from './cip-parse.mjs';

const SHEET = [
  'C.I.P.', '9 mm Luger', 'TAB.', 'IV',
  'Country of Origin: DE',
  'Alternative Names: 9 mm Para(bellum), 9 x 19 (mm)',
  'CARTRIDGE MAXI',
  'Lengths', 'L1', '=', 'L2', '=', 'L3 1)', '=', '19.15', '-0.25',
  'L4', '=', 'L5', '=', 'L6', '=', '29.69',
  'Case Head', 'R', '=', '1.27', 'R1', '=', '9.96',
  'Powder Chamber', 'P1', '=', '9.93',
  'Collar', 'H1', '=', 'H2 1)', '=', '9.65',
  'Projectile', 'G1 1)', '=', '9.03',
  'Pressures (Energies)', 'Pmax', '=', '2350 bar', 'PK', '=', '2703 bar',
  'Miscellaneous Dimensions', 'delta L', '=',
  'CHAMBER MINI',
  'Lengths', 'L3 1)', '=', '19.15',
  'Breech', 'R1', '=', '10.00',
  'Powder Chamber', 'P1 1)', '=', '9.96',
  'Collar', 'H2 1)', '=', '9.68',
  'Commencement of Rifling', 'G1 1)*', '=', '9.05',
  'Grooves', 'N', '=', '6', 'u', '=', '250.00',
].join('\n');

test('the two sections are kept apart — the same letter means two things', () => {
  // The bug this exists for: `delta L =` has no value, so the value slot holds
  // the literal line "CHAMBER MINI". Consuming it swallowed the section header
  // and wrote every chamber dimension into the cartridge, giving the 9 mm Luger
  // a bullet diameter of 9.05 mm where the real maximum is 9.03.
  const sheet = parseDatasheet(SHEET);
  assert.equal(sheet.cartridge.G1.value, 9.03);
  assert.equal(sheet.chamber.G1.value, 9.05);
  assert.equal(sheet.cartridge.R1.value, 9.96);
  assert.equal(sheet.chamber.R1.value, 10);
  assert.equal(sheet.cartridge.P1.value, 9.93);
  assert.equal(sheet.chamber.P1.value, 9.96);
});

test('the cartridge block reproduces the hand transcription of the pilot batch', () => {
  const sheet = parseDatasheet(SHEET);
  const expected: Record<string, number> = {
    caseLength: 19.15,
    overallLength: 29.69,
    bulletDiameter: 9.03,
    rimDiameter: 9.96,
    baseDiameter: 9.93,
    neckDiameter: 9.65,
  };
  for (const { letter, field } of CARTRIDGE_DIMENSIONS) {
    assert.equal(sheet.cartridge[letter]?.value, expected[field], field);
  }
});

test('pressure is lifted out of the dimension blocks and is in bar', () => {
  const sheet = parseDatasheet(SHEET);
  assert.equal(sheet.meta.Pmax.value, 2350);
  assert.equal(sheet.meta.Pmax.value / 10, 235); // bar → MPa, exactly
  assert.equal(sheet.cartridge.Pmax, undefined);
});

test('an unspecified dimension is absent, never zero', () => {
  const sheet = parseDatasheet(SHEET);
  assert.equal(sheet.cartridge.L1, undefined);
  assert.equal(sheet.cartridge.L4, undefined);
  assert.equal(sheet.cartridge.H1, undefined);
});

test('the header block is read', () => {
  const sheet = parseDatasheet(SHEET);
  assert.equal(sheet.meta.name, '9 mm Luger');
  assert.equal(sheet.meta.countryOfOrigin, 'DE');
  assert.match(sheet.meta.alternativeNames, /9 x 19/);
});

test('the comma decimal is read as a decimal, not as grouping', () => {
  assert.equal(cipNumber('19,15'), 19.15);
  assert.equal(cipNumber('2350'), 2350);
  assert.equal(cipNumber('4 050'), 4050);
  assert.equal(cipNumber(''), null);
});

const INDEX = `
<tr id="cartridge-772" class="odd published"><td>9 mm Luger</td><td class="hide_mobile">1984-06-14</td><td class="hide_mobile">2008-09-23</td><td>Germany</td>
<td class="pictoLink"><a href="/uploads/tdcc/tab-iv/tabivcal-fr-page28.pdf">FR</a><a href="/uploads/tdcc/tab-iv/tabivcal-en-page28.pdf">EN</a></td>
<td title="location of the pressure take (mm)" class="hide_mobile">12,50</td>
<td title="maximum average pressure (bar)" class="hide_mobile">2350</td></tr>
<tr id="cartridge-1586" class="even published"><td>22 Advanced Rifle Cartridge</td><td class="hide_mobile">2024-05-14</td><td class="hide_mobile"></td><td>United states</td>
<td class="pictoLink"><a href="/uploads/tdcc/tab-i/22-arc-en.pdf">EN</a></td>
<td title="location of the pressure take (mm)" class="hide_mobile">25,00</td>
<td title="maximum average pressure (bar)" class="hide_mobile">4050</td></tr>`;

test('the index yields pressure without fetching a single PDF', () => {
  const rows = parseIndex(INDEX, 4);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, '9 mm Luger');
  assert.equal(rows[0].pmaxBar, 2350);
  assert.equal(rows[0].revised, '2008-09-23');
  assert.equal(rows[1].revised, null);
});

test('the English datasheet is found when the language tag is mid-filename', () => {
  // Table IV serves `tabivcal-en-page28.pdf`. Matching only a `-en.pdf` suffix
  // found a datasheet for 215 of 672 cartridges and missed 9 mm Luger.
  const rows = parseIndex(INDEX, 4);
  assert.match(rows[0].datasheetUrl ?? '', /tabivcal-en-page28\.pdf$/);
  assert.match(rows[1].datasheetUrl ?? '', /22-arc-en\.pdf$/);
});

test('a metric or military name finds the commercial one C.I.P. files it under', () => {
  const rows = parseIndex(INDEX, 4);
  assert.deepEqual(searchIndex(rows, '9×19mm Parabellum').map((r) => r.name), ['9 mm Luger']);
  assert.deepEqual(searchIndex(rows, '9x19').map((r) => r.name), ['9 mm Luger']);
});

test('a query is not matched by a row whose name it merely contains', () => {
  // `9x19` matching a row called `9 mm` — the normalised `9` is a substring of
  // nearly everything, and a wrong datasheet is worse than none.
  const rows = parseIndex('<tr id="cartridge-1"><td>9 mm</td><td></td><td></td><td>US</td><td></td></tr>', 3);
  assert.deepEqual(searchIndex(rows, '9x19'), []);
});

test('no match for a purely military cartridge is the correct answer, not a failure', () => {
  // FRICTION-LOG A4. C.I.P. standardises the commercial round only.
  const rows = parseIndex(INDEX, 4);
  assert.deepEqual(searchIndex(rows, '5.56×45mm NATO'), []);
  assert.equal(normaliseName('5.56×45mm NATO'), '5.56x45nato');
});
