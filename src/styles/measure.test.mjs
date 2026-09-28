/**
 * The reading-measure invariant.
 *
 * **Text is never capped more tightly than its column.** Prose used to carry
 *     width classes (`max-w-readable`, `max-w-lede`, `max-w-note`) that stopped
 *     paragraphs at 34 to 50rem inside a 75rem frame, so page after page showed
 *     text wrapping at half width beside empty space. The frame and the layout's
 *     columns bound a line; nothing else may. This test fails if a prose cap
 *     comes back.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** Width caps on prose, in any spelling: the named classes or an arbitrary rem/ch width. */
const PROSE_CAP = /\bmax-w-(?:readable|lede|note|prose|\[\d+(?:\.\d+)?(?:rem|ch)\])(?![\w-])/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(astro|svelte)$/.test(full)) out.push(full);
  }
  return out;
}

test('no paragraph is capped narrower than the column it sits in', () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    if (rel.startsWith('pages/dev/')) continue;
    const source = readFileSync(file, 'utf8');
    // The 404 is centred: a centred block has no one-sided empty space.
    if (rel === 'pages/404.astro') continue;
    for (const [, list] of source.matchAll(/class[:=]\s*\{?["'`]([^"'`]*)["'`]/g)) {
      const hit = list.match(PROSE_CAP);
      if (hit) offenders.push(`${rel}: ${hit[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Text fills its column; a width cap on prose left paragraphs at half the page:\n  ' + offenders.join('\n  '),
  );
});
