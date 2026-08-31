/**
 * Instruction.md Phase 9 states one definition of done as a negative: the image
 * fetcher **cannot emit an `imageRef` missing licence data**. A negative is
 * exactly the kind of guarantee that rots quietly — nobody notices the day it
 * stops holding — so it is asserted here rather than trusted.
 *
 * These tests are pure: `buildImageRef` does no I/O, which is why the gate was
 * put in its own module instead of inside `image.mjs`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildImageRef, licenseTypeFor, licenseVersionFrom } from './imageref.mjs';

const commonsCcBySa = {
  onCommons: true,
  pageUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
  licenseShortName: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  author: 'A Photographer',
  title: 'File:Example.jpg',
};

test('a complete Commons record produces a valid imageRef', () => {
  const ref = buildImageRef({
    src: 'images/guns/example/hero.webp',
    width: 1600,
    height: 900,
    meta: commonsCcBySa,
  });
  assert.equal(ref.credit.licenseType, 'cc-by-sa');
  assert.equal(ref.credit.licenseVersion, '4.0');
  assert.equal(ref.credit.author, 'A Photographer');
  assert.equal(ref.width, 1600);
});

test('no metadata at all is refused', () => {
  assert.throws(() => buildImageRef({ src: 'images/x.webp', meta: null }), /without a licence/);
});

test('no source page URL is refused — SPEC.md §10 wants the file page', () => {
  assert.throws(
    // @ts-expect-error — the point of the test is a record with no page URL.
    () => buildImageRef({ src: 'images/x.webp', meta: { ...commonsCcBySa, pageUrl: undefined } }),
    /source page URL/,
  );
});

test('an unreported licence is refused rather than defaulted', () => {
  assert.throws(
    () =>
      buildImageRef({
        src: 'images/x.webp',
        meta: { ...commonsCcBySa, licenseShortName: null, licenseUrl: null },
      }),
    /not in the licenseType enum/,
  );
});

test('an attribution licence with no author is refused by the real schema', () => {
  // The rule lives in `primitives.ts`, not here. This asserts the gate actually
  // runs it — a builder that hand-rolled its own validation would drift.
  assert.throws(
    () => buildImageRef({ src: 'images/x.webp', meta: { ...commonsCcBySa, author: null } }),
    /requires attribution/,
  );
});

test('OGL and Licence Ouverte are named, not mapped to cc-by', () => {
  // FRICTION-LOG D2. Both are attribution licences that resemble CC BY closely
  // enough that "close enough" is the tempting mistake; the file would then
  // carry a licence name it is not under.
  for (const short of ['OGL v1.0', 'Licence Ouverte']) {
    assert.equal(licenseTypeFor(short), null, `${short} must not map to an enum member`);
    assert.throws(
      () => buildImageRef({ src: 'images/x.webp', meta: { ...commonsCcBySa, licenseShortName: short } }),
      /Do NOT map it to cc-by/,
    );
  }
});

test('share-alike is not flattened to CC BY', () => {
  // Ordering bug with a silent consequence: the share-alike obligation would
  // simply disappear from the credit popover.
  assert.equal(licenseTypeFor('CC BY-SA 3.0'), 'cc-by-sa');
  assert.equal(licenseTypeFor('CC BY 2.0'), 'cc-by');
  assert.equal(licenseTypeFor('CC0'), 'cc0');
  assert.equal(licenseTypeFor('Public domain'), 'public-domain');
  assert.equal(licenseTypeFor('GFDL'), 'gfdl');
});

test('a public-domain file needs no author', () => {
  const ref = buildImageRef({
    src: 'images/guns/example/hero.webp',
    meta: {
      pageUrl: 'https://commons.wikimedia.org/wiki/File:PD.jpg',
      licenseShortName: 'Public domain',
      author: null,
    },
  });
  assert.equal(ref.credit.licenseType, 'public-domain');
  assert.equal(ref.credit.author, undefined);
});

test('alt and caption are emitted as TODO, never as the source description', () => {
  // FRICTION-LOG D5: a Commons description describes the file, and is sometimes
  // about a different variant than the entry. Copying it into `alt` produces
  // text that passes the schema and misdescribes the photograph.
  const ref = buildImageRef({
    src: 'images/guns/example/hero.webp',
    meta: { ...commonsCcBySa, description: 'Soviet AK-47, Type 2A made from 1951' },
  });
  assert.match(ref.alt, /^TODO/);
  assert.match(ref.caption ?? '', /^TODO/);
  assert.doesNotMatch(ref.alt, /Type 2A/);
});

test('dimensions are omitted rather than nulled when not measured', () => {
  // The schema takes an absent width over a null one, and printing `null`
  // hands the author a field that fails validation.
  const ref = buildImageRef({ src: 'images/x.webp', meta: commonsCcBySa });
  assert.equal('width' in ref, false);
  assert.equal(licenseVersionFrom('CC BY-SA 4.0'), '4.0');
  assert.equal(licenseVersionFrom('CC0'), undefined);
});
