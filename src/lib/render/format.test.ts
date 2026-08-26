/**
 * Formatting, where a number stops being data and becomes something a reader
 * has to be able to act on.
 *
 * The interesting rule is precision. A fixed decimal count per unit — which
 * this module used to carry — is right at the magnitude that unit usually holds
 * and wrong at the other end of it: the site's flagship derived figure, free
 * recoil, rendered as "4 J" beside a muzzle energy of "3,629 J", and a case
 * length published by C.I.P. as 19.15 mm rendered as 19.1 mm, quietly dropping
 * a digit the datasheet actually gave.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { formatValue, formatYears } from './format.ts';

const metric = (value: number, unit: string): string => formatValue(value, unit)!.metric;
const imperial = (value: number, unit: string): string => formatValue(value, unit)!.imperial;

test('a figure is never shown to more precision than it was recorded with', () => {
  // The source published 114, not 114.0. A trailing digit nobody measured is a
  // small silent version of inventing a figure.
  assert.equal(metric(114, 'mm'), '114 mm');
  assert.equal(metric(3.9, 'kg'), '3.9 kg');
  assert.equal(metric(235, 'MPa'), '235 MPa');
});

test('a figure recorded to two decimals keeps both of them', () => {
  assert.equal(metric(19.15, 'mm'), '19.15 mm');
  assert.equal(metric(9.03, 'mm'), '9.03 mm');
  assert.equal(metric(0.625, 'kg'), '0.625 kg');
});

test('a derived float is cut to four significant figures, not to fourteen', () => {
  assert.equal(metric(3.77281670211346, 'J'), '3.773 J');
  assert.equal(metric(2.047312, 'm/s'), '2.047 m/s');
  assert.equal(metric(3629.4412, 'J'), '3,629 J');
});

test('a large figure is grouped so it can be read at a glance', () => {
  assert.equal(metric(2400000, ''), '2,400,000');
  assert.equal(metric(3629, 'J'), '3,629 J');
});

test('a count or a rate is the same figure in both systems', () => {
  // Without this a capacity of 17 renders as "17.00" the moment a reader
  // switches the toggle, which looks like a different number.
  const capacity = formatValue(17, '')!;
  assert.equal(capacity.metric, '17');
  assert.equal(capacity.imperial, '17');
  assert.equal(capacity.identical, true);

  const rate = formatValue(700, 'rpm')!;
  assert.equal(rate.identical, true);
});

test('the imperial figure is cut on its own scale, having no stored precision', () => {
  assert.equal(imperial(8.1637, 'J'), '6.021 ft·lbf');
  assert.equal(imperial(3629, 'J'), '2,677 ft·lbf');
  assert.equal(imperial(19.15, 'mm'), '0.7539 in');
});

test('a missing figure formats as nothing rather than as zero', () => {
  assert.equal(formatValue(null, 'kg'), null);
  assert.equal(formatValue(Number.NaN, 'kg'), null);
});

test('a unit with no imperial equivalent passes through unchanged', () => {
  const formatted = formatValue(7.98, 'N·s')!;
  assert.equal(formatted.identical, true);
  assert.equal(formatted.metric, '7.98 N·s');
});

test('an open production range reads as open', () => {
  assert.equal(formatYears({ start: 1982, end: null }), '1982–present');
  assert.equal(formatYears({ start: 1994, end: 2011 }), '1994–2011');
  assert.equal(formatYears(null), null);
});
