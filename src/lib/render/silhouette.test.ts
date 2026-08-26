/**
 * The silhouette's honesty rules — SPEC.md §9.6.
 *
 * The drawing is allowed to be generic. What it is not allowed to do is imply a
 * measurement nobody took, so these tests are about which parts of the outline
 * are claims: the scale is one, the height is one only when it was recorded,
 * and an entry with no length is not drawn at all.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { buildScene, silhouetteFor, type SilhouetteSubject } from './silhouette.ts';

const subject = (over: Partial<SilhouetteSubject> = {}): SilhouetteSubject => ({
  id: 'entry',
  name: 'Entry',
  type: 'pistol',
  lengthMm: 186,
  heightMm: 138,
  barrelLengthMm: 114,
  hasMagazine: true,
  ...over,
});

test('an entry with no recorded length is not drawn', () => {
  // Length is the axis of the comparison. Guessing it would make the one thing
  // the reader is measuring the one thing we invented.
  assert.equal(silhouetteFor(subject({ lengthMm: null })), null);
  assert.equal(silhouetteFor(subject({ lengthMm: 0 })), null);
});

test('an undrawable entry is named rather than dropped', () => {
  const scene = buildScene([subject(), subject({ id: 'thin', name: 'Thin', lengthMm: null })]);
  assert.equal(scene.silhouettes.length, 1);
  assert.deepEqual(scene.omitted, [
    { id: 'thin', name: 'Thin', because: 'no sourced overall length' },
  ]);
});

test('a recorded height is used, and an unrecorded one is flagged', () => {
  const sourced = silhouetteFor(subject())!;
  assert.equal(sourced.heightMm, 138);
  assert.equal(sourced.heightSourced, true);

  const inferred = silhouetteFor(subject({ heightMm: null }))!;
  assert.equal(inferred.heightSourced, false);
  assert.ok(inferred.heightMm > 0, 'the outline still has a height — it is just not a measurement');
  assert.notEqual(inferred.heightMm, 138);
});

test('the path is drawn in millimetres, at true scale', () => {
  const drawn = silhouetteFor(subject({ lengthMm: 760, heightMm: 210 }))!;
  const xs = [...drawn.path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ys = [...drawn.path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]));
  assert.equal(Math.max(...xs), 760, 'the outline reaches the recorded length exactly');
  assert.equal(Math.min(...xs) >= 0, true);
  assert.ok(Math.max(...ys) <= 210.001);
});

test('a sourced barrel length changes the outline; an absent one falls back', () => {
  const short = silhouetteFor(subject({ type: 'rifle', lengthMm: 1000, barrelLengthMm: 400 }))!;
  const long = silhouetteFor(subject({ type: 'rifle', lengthMm: 1000, barrelLengthMm: 600 }))!;
  assert.notEqual(short.path, long.path, 'barrel length is drawn from data, not decoration');
  assert.equal(short.barrelSourced, true);

  const none = silhouetteFor(subject({ type: 'rifle', lengthMm: 1000, barrelLengthMm: null }))!;
  assert.equal(none.barrelSourced, false);
});

test('a magazine is drawn only where the feed system has one', () => {
  const withMag = silhouetteFor(subject({ type: 'rifle', hasMagazine: true }))!;
  const without = silhouetteFor(subject({ type: 'rifle', hasMagazine: false }))!;
  assert.notEqual(withMag.path, without.path);
  // Its presence is a fact about the arm even though its shape is not.
  assert.ok(withMag.path.length > without.path.length);
});

test('the scene shares one coordinate system across every entry', () => {
  const scene = buildScene([
    subject({ id: 'pistol', lengthMm: 186, heightMm: 138 }),
    subject({ id: 'carbine', type: 'carbine', lengthMm: 760, heightMm: 210 }),
  ]);
  // The box is the longest arm's, so the pistol occupies a quarter of it —
  // which is the whole point of drawing them together.
  assert.equal(scene.widthMm, 760);
  assert.equal(scene.heightMm, 210);
});

test('a handgun and a long arm get different profiles', () => {
  const pistol = silhouetteFor(subject({ type: 'pistol' }))!;
  const rifle = silhouetteFor(subject({ type: 'rifle' }))!;
  assert.notEqual(pistol.path, rifle.path);
});

test('an entry with no type still draws, on the fallback profile', () => {
  const platform = silhouetteFor(subject({ type: null }));
  assert.ok(platform, 'a family entry has no type and must still be drawable');
});
