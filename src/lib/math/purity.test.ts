/**
 * Structural guarantees about `lib/math` — Instruction.md Phase 3's definition
 * of done, and two of SPEC.md's red lines made mechanical.
 *
 * These assertions do not test behaviour. They test that the code cannot drift
 * into shapes the architecture forbids, which is the kind of rule that is
 * obeyed for six months and then quietly broken by someone in a hurry:
 *
 *  1. **Purity.** No DOM, no I/O, no Astro or Svelte import anywhere under
 *     `lib/math`. The whole point of SPEC.md §2 principle 5 is that a
 *     build-time figure and a client-recomputed one are the same function's
 *     output — which stops being true the moment one of these functions can
 *     read something the other cannot.
 *  2. **No fps-per-inch constant, anywhere in the codebase.** SPEC.md §8.2.
 *  3. **No damage, lethality or stopping-power metric, anywhere.** SPEC.md §14.
 *
 * Comments are stripped before scanning, so a file may — and `velocity.ts` and
 * `energy.ts` do — explain at length why these things are absent.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const mathRoot = path.join(repoRoot, 'src', 'lib', 'math');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'dist') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|mjs|js|astro|svelte)$/.test(name)) out.push(full);
  }
  return out;
}

/** Line and block comments removed, so prose about a rule is not the rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const rel = (file: string) => path.relative(repoRoot, file).split(path.sep).join('/');

const mathFiles = walk(mathRoot).filter((f) => !f.endsWith('.test.ts'));
const codeFiles = [
  ...walk(path.join(repoRoot, 'src')),
  ...walk(path.join(repoRoot, 'scripts')),
].filter((f) => !f.endsWith('purity.test.ts'));

test('lib/math has files to be pure about', () => {
  // Guards the guard: a walker that silently returns nothing would make every
  // assertion below pass forever.
  assert.ok(mathFiles.length >= 10, `only found ${mathFiles.length} files under lib/math`);
});

test('lib/math imports no framework, no DOM and no I/O', () => {
  const forbidden = [
    { pattern: /from\s+['"]astro/i, why: 'Astro import' },
    { pattern: /from\s+['"]svelte/i, why: 'Svelte import' },
    { pattern: /from\s+['"]node:(fs|path|http|child_process|os|url)/i, why: 'Node I/O import' },
    { pattern: /\bdocument\s*\./, why: 'DOM access' },
    { pattern: /\bwindow\s*\./, why: 'window access' },
    { pattern: /\blocalStorage\b/, why: 'localStorage access' },
    { pattern: /\bfetch\s*\(/, why: 'network access' },
    { pattern: /\bimport\.meta\.env\b/, why: 'build environment access' },
    { pattern: /\bprocess\.env\b/, why: 'process environment access' },
    { pattern: /\bMath\.random\s*\(/, why: 'non-determinism' },
    { pattern: /\bDate\.now\s*\(/, why: 'non-determinism' },
  ];

  const failures: string[] = [];
  for (const file of mathFiles) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const { pattern, why } of forbidden) {
      if (pattern.test(code)) failures.push(`${rel(file)}: ${why}`);
    }
  }

  assert.equal(
    failures.length,
    0,
    `lib/math must be pure — a build-time figure and a client-recomputed one can only agree if they are the same function:\n  ${failures.join('\n  ')}`,
  );
});

test('lib/math imports nothing outside lib/math except its own siblings', () => {
  // Importing the content schemas here would be the first step toward the math
  // engine knowing about files, which is how a "pure function" acquires an
  // opinion about where it is running.
  const failures: string[] = [];
  for (const file of mathFiles) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const match of code.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = match[1]!;
      if (spec.startsWith('.')) continue;
      failures.push(`${rel(file)}: imports the package '${spec}'`);
    }
  }
  assert.equal(failures.length, 0, `lib/math must not depend on packages:\n  ${failures.join('\n  ')}`);
});

test('no fps-per-inch constant exists anywhere in the codebase', () => {
  // SPEC.md §8.2. "About 25 fps per inch of barrel" is the most repeated number
  // in the subject and it is a fabrication with a lab coat on: the real figure
  // depends on cartridge, powder and where on the curve you are, and can go
  // negative. Velocity comes from sourced points and interpolation between
  // them, or it does not come at all.
  const patterns = [
    /fps[\s_-]*per[\s_-]*inch/i,
    /feet[\s_-]*per[\s_-]*second[\s_-]*per[\s_-]*inch/i,
    /\bFPS_PER_INCH\b/,
    /\bfpsPerInch\b/,
    /\bvelocityPerInch\b/,
    /\bperInchGain\b/,
    /\bBARREL_VELOCITY_(GAIN|FACTOR|CONSTANT)\b/i,
  ];

  const failures: string[] = [];
  for (const file of codeFiles) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const pattern of patterns) {
      if (pattern.test(code)) failures.push(`${rel(file)}: matches ${pattern}`);
    }
  }

  assert.equal(
    failures.length,
    0,
    `a barrel-length velocity constant has appeared. Extrapolation is forbidden by SPEC.md §8.2:\n  ${failures.join('\n  ')}`,
  );
});

test('no damage, lethality or stopping-power metric exists anywhere', () => {
  // SPEC.md §14, a permanent exclusion rather than a v1 deferral. Muzzle and
  // retained energy are physics and appear prominently; "stopping power" is
  // discredited pseudoscience and would be the most-attacked claim on the site.
  // Taylor's Knock-Out factor is listed in SPEC.md §8.1 and is deliberately not
  // implemented, because it is one of these — see `ballistics/energy.ts`.
  const patterns = [
    /\bstoppingPower\b/i,
    /\bSTOPPING_POWER\b/i,
    /\blethality\b/i,
    /\bwoundChannel\b/i,
    /\bknockOut(Factor|Value)?\b/i,
    /\btaylorKO\b/i,
    /\bTKO_\w+\b/,
    /\bdamageValue\b/i,
  ];

  const failures: string[] = [];
  for (const file of codeFiles) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const pattern of patterns) {
      if (pattern.test(code)) failures.push(`${rel(file)}: matches ${pattern}`);
    }
  }

  assert.equal(
    failures.length,
    0,
    `SPEC.md §14 forbids any damage, lethality or stopping-power metric:\n  ${failures.join('\n  ')}`,
  );
});
