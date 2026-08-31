/**
 * The awkward cases in real arms infoboxes, held to tests rather than to
 * anyone's memory. Every fixture below is copied from an article the pilot
 * batch actually sourced from.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  armsInfobox,
  extractBareQuantity,
  extractConvert,
  fieldReferences,
  fieldValues,
  infoboxName,
  infoboxFields,
  parseConvert,
  parseLocalisedNumber,
  plain,
  readField,
  splitTopLevel,
  toSi,
} from './wikitext.mjs';

test('splitTopLevel ignores pipes nested in templates and links', () => {
  const parts = splitTopLevel('a|{{convert|1|-|2|kg}}|[[x|y]]|b');
  assert.deepEqual(parts, ['a', '{{convert|1|-|2|kg}}', '[[x|y]]', 'b']);
});

test('a convert keeps the SOURCE unit, which is often imperial', () => {
  // `{{convert|16|in|mm|0}}` means the publisher wrote 16 inches. Recording
  // 406.4 mm is right; recording it without saying so is not.
  const parsed = parseConvert('{{convert|16|in|mm|0}}');
  assert.deepEqual(parsed?.values, [16]);
  assert.equal(parsed?.unit, 'in');
  assert.equal(parsed?.target, 'mm');
  const si = toSi(16, 'in');
  assert.equal(Number(si?.value.toFixed(1)), 406.4);
  assert.match(si?.note ?? '', /Published as 16 in/);
});

test('a convert range comes back as two values, not a midpoint', () => {
  const parsed = parseConvert('{{convert|1450|-|1619|kg}}');
  assert.deepEqual(parsed?.values, [1450, 1619]);
});

test('the AK-47 weight field splits into its qualified values', () => {
  const raw =
    'Without magazine:<br />{{convert|3.47|kg|lb|abbr=on}}<br />Magazine, empty:<br />{{convert|0.43|kg|lb|abbr=on}} (early issue)';
  const entries = readField({ weight: raw }, 'weight');
  assert.equal(entries.length, 4);
  assert.deepEqual(entries[1].values, [3.47]);
  assert.deepEqual(entries[3].values, [0.43]);
  assert.match(entries[3].qualifier ?? '', /early issue/);
});

test('a cartridge designation is never read as a measurement', () => {
  // The bug this test exists for: `7.62×39mm` parsed as "39 mm" and was offered
  // to the author as a length. Plausible, wrong, and silent.
  assert.equal(extractBareQuantity('7.62×39mm'), null);
  assert.equal(extractBareQuantity('9×19mm Parabellum'), null);
  assert.equal(extractBareQuantity('.45 ACP'), null);
  assert.equal(extractBareQuantity('5.56×45mm NATO'), null);
});

test('a bare quantity with no {{convert}} is still recovered', () => {
  // Arms infoboxes are much less disciplined about {{convert}} than car ones.
  // The AK-47 writes its cyclic rate as plain text.
  const found = extractBareQuantity('600 rounds/min');
  assert.deepEqual(found?.values, [600]);
  assert.equal(found?.unit, 'rounds/min');
  assert.equal(toSi(600, 'rounds/min')?.unit, 'rpm');
});

test('a bare range keeps both ends', () => {
  const found = extractBareQuantity('100–800 m adjustable iron sights');
  assert.deepEqual(found?.values, [100, 800]);
  assert.equal(found?.unit, 'm');
});

test('grains convert exactly, because every US bullet mass is published in them', () => {
  assert.equal(toSi(1, 'gr')?.factor, 0.06479891);
  assert.equal(Number(toSi(115, 'gr')?.value.toFixed(4)), 7.4519);
});

test('pressure converts from both bar and psi, since C.I.P. and SAAMI disagree on units', () => {
  assert.equal(Number(toSi(2350, 'bar')?.value.toFixed(1)), 235.0);
  assert.equal(Number(toSi(35000, 'psi')?.value.toFixed(1)), 241.3);
});

test('the cartridge infobox is found, not just the weapon one', () => {
  const wikitext = '{{Infobox firearm cartridge\n|name= 9 mm\n|case_length= 19.15\n}}';
  const box = armsInfobox(wikitext);
  assert.ok(box);
  assert.equal(infoboxName(box), 'infobox firearm cartridge');
  assert.equal(infoboxFields(box).case_length, '19.15');
});

test('field references survive the ref-stripping that cleans the value', () => {
  // The point of `fieldReferences`: the citation attached to an infobox line is
  // usually the manual the figure came from, and stripping it to clean the
  // value throws away the only source that could carry `verified`.
  const box =
    '{{Infobox weapon\n|weight= {{convert|3.4|kg}}<ref>{{cite book|title=FM 3-22.9|url=https://example.org/fm}}</ref>\n}}';
  assert.equal(infoboxFields(box).weight, '{{convert|3.4|kg}}');
  const refs = fieldReferences(box, 'weight');
  assert.deepEqual(refs.urls, ['https://example.org/fm']);
  assert.deepEqual(refs.titles, ['FM 3-22.9']);
});

test('a named ref resolves to nothing rather than to an invented citation', () => {
  const box = '{{Infobox weapon\n|number= ~75 million<ref name="k3" />\n}}';
  assert.deepEqual(fieldReferences(box, 'number').urls, []);
});

test('an unbulleted list is several values, not one string', () => {
  assert.deepEqual(fieldValues('{{ubl|semi-automatic|fully automatic}}'), [
    'semi-automatic',
    'fully automatic',
  ]);
});

test('a comma decimal is read correctly, and a genuinely ambiguous one is flagged', () => {
  // C.I.P. writes 19,15 mm; a German article writes 1.200 for 1200. The first
  // is unambiguous, the second is not, and guessing gives a figure wrong by a
  // factor of a thousand that a validator has no way to notice.
  assert.equal(parseLocalisedNumber('19,15', 'de')?.value, 19.15);
  assert.equal(parseLocalisedNumber('19,15', 'de')?.ambiguous, false);
  const ambiguous = parseLocalisedNumber('1.200', 'de');
  assert.equal(ambiguous?.ambiguous, true);
  assert.equal(ambiguous?.value, 1200);
  assert.match(ambiguous?.note ?? '', /confirm against the source/);
});

test('plain() removes markup without eating the text', () => {
  assert.equal(plain("[[Gas-operated reloading|Gas-operated]], '''closed''' bolt"), 'Gas-operated, closed bolt');
});

test('extractConvert keeps the prose that says which figure it is', () => {
  const found = extractConvert('Fixed wooden stock: {{convert|880|mm|abbr=on}}');
  assert.deepEqual(found?.values, [880]);
  assert.match(found?.qualifier ?? '', /Fixed wooden stock/);
});
