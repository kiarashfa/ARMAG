/**
 * The reading-measure invariants.
 *
 * ── The bug this file exists to stop coming back ──────────────────────────
 * The measures were authored in `ch`. `ch` is the width of the "0" glyph in
 * the ELEMENT'S OWN font, so one class produced three different widths on the
 * same page: `max-w-readable` measured 655px on a 16px paragraph, 574px on a
 * 14px one, and 492px on a 12px caption. The footer disclaimer is set at 12px,
 * so its "92ch" lede resolved to 570px and stopped at 40% of a 1440px page,
 * which looked exactly like a broken layout because it was one.
 *
 * Two rules follow, and both are checked here rather than left to review:
 *
 *  1. **The measures are font-size independent.** Anchored to the root font
 *     size, so a measure is a statement about the reading column rather than
 *     about whatever type size happens to sit in it.
 *  2. **A measure only goes on body-size prose.** A caption at `text-xs` does
 *     not need a reading measure — it needs to fit its container — and pairing
 *     the two is what made the bug visible in the first place. The pairing is
 *     banned outright so the question never has to be argued case by case.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const CSS = readFileSync(new URL('./global.css', import.meta.url), 'utf8');

const MEASURE_CLASSES = ['max-w-readable', 'max-w-lede'];

/** Type sizes smaller than the body register. */
const SMALL_TEXT = ['text-xs', 'text-sm'];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(astro|svelte)$/.test(full)) out.push(full);
  }
  return out;
}

test('the measures are anchored to the root font size, never to the element', () => {
  for (const token of ['--measure-readable', '--measure-lede']) {
    const match = new RegExp(`${token}:\\s*([^;]+);`).exec(CSS);
    assert.ok(match, `${token} is not defined in global.css`);
    const value = match[1].trim();
    assert.match(
      value,
      /^\d+(\.\d+)?rem$/,
      `${token} is "${value}". A measure in ch, em or % re-resolves against the element's own font size, ` +
        'which is how one class came to mean three different widths on one page.',
    );
  }
});

test('no element carries a reading measure and a small type size at once', () => {
  const offenders = [];

  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8');
    // Every class list in the file, however it is written: class="...",
    // class={`...`} and Svelte's class={...} all put the names in quotes or
    // backticks, so the attribute value is what gets scanned.
    for (const [, list] of source.matchAll(/class[:=]\s*\{?["'`]([^"'`]*)["'`]/g)) {
      const classes = list.split(/\s+/);
      const measure = MEASURE_CLASSES.find((name) => classes.includes(name));
      const small = SMALL_TEXT.find((name) => classes.includes(name));
      if (measure && small) {
        offenders.push(`${path.relative(SRC, file).split(path.sep).join('/')}: ${measure} + ${small}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'A reading measure belongs on body-size prose only. Small text should be bounded by its ' +
      'container or by an explicit width, not by a measure meant for paragraphs:\n  ' +
      offenders.join('\n  '),
  );
});
