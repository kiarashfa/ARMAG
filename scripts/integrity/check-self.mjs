#!/usr/bin/env node
/**
 * `npm run check:self` — gate 7. Proves the other six gates still bite.
 *
 * SPEC.md §13: CI runs the checks against a known-bad fixture set which must
 * still fail, "proves the checks haven't silently stopped catching problems".
 * A check that has quietly stopped catching anything is worse than no check,
 * because the green build is then a claim nobody is testing.
 *
 * Read the exit code carefully, because the two senses of "fail" are easy to
 * confuse:
 *
 *   exit 0  →  the checks correctly REJECTED every broken fixture. Good.
 *   exit 1  →  a fixture the checks are supposed to catch slipped through,
 *              i.e. a check has rotted. This is the alarm.
 *
 * `expected-violations.json` lists the (file, rule) pairs that must be
 * reported, plus `messageContains` where the rule id alone is too generic to
 * pin the refinement under test. Extra violations beyond that list are printed
 * as a note rather than an error — adding a new check must not break this gate.
 *
 * The three gates that act on artefacts rather than on content — the asset
 * budget and the secret-leak check — are driven as subprocesses against their
 * own fixtures, which is why those scripts take `--root`, `--dist` and `--env`
 * flags at all.
 */
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runIntegrityChecks } from '../../src/integrations/integrity-checks.ts';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixtureRoot = path.join(root, 'test-fixtures', 'broken-content');

const manifest = JSON.parse(
  await readFile(path.join(fixtureRoot, 'expected-violations.json'), 'utf8'),
);

const normalise = (file) => file.split(path.sep).join('/');

// ---------------------------------------------------------------------------
// The content gates
// ---------------------------------------------------------------------------

const violations = await runIntegrityChecks({
  contentRoot: path.join(fixtureRoot, 'content'),
  displayRoot: root,
});

const reported = violations.map((v) => ({ ...v, file: normalise(v.file) }));
const failures = [];

for (const expectation of manifest.expected) {
  const file = normalise(expectation.file);
  for (const rule of expectation.rules) {
    const matches = reported.filter((v) => v.file === file && v.rule === rule);
    if (matches.length === 0) {
      failures.push({
        what: `${file}\n    missing rule: ${rule}`,
        why: expectation.why,
      });
      continue;
    }
    if (
      expectation.messageContains &&
      !matches.some((v) => v.message.includes(expectation.messageContains))
    ) {
      failures.push({
        what: `${file}\n    rule ${rule} fired, but no message contained "${expectation.messageContains}"\n    got: ${matches.map((m) => m.message).join('\n         ')}`,
        why: expectation.why,
      });
    }
  }
}

const expectedTokens = new Set(
  manifest.expected.flatMap((e) => e.rules.map((r) => `${normalise(e.file)}::${r}`)),
);
const extra = [...new Set(reported.map((v) => `${v.file}::${v.rule}`))].filter(
  (t) => !expectedTokens.has(t),
);

console.log(
  `[check:self] ${manifest.expected.length} fixture expectation(s); the content gates reported ${violations.length} violation(s).`,
);

if (violations.length === 0) {
  console.error(
    '\ncheck:self FAILED — the broken fixtures produced NO violations at all.\n' +
      'The integrity checks have stopped working entirely.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The artefact gates, run as subprocesses against their own fixtures
// ---------------------------------------------------------------------------

for (const expectation of manifest.expectedScriptFailures ?? []) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, expectation.script), ...expectation.argv],
    { cwd: root, encoding: 'utf8' },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  if (result.status === 0) {
    failures.push({
      what: `${expectation.script} ${expectation.argv.join(' ')}\n    exited 0 — it did not reject its own known-bad fixture`,
      why: expectation.why,
    });
    continue;
  }
  if (expectation.stderrContains && !output.includes(expectation.stderrContains)) {
    failures.push({
      what: `${expectation.script} ${expectation.argv.join(' ')}\n    failed, but not for the expected reason: no output contained "${expectation.stderrContains}"\n    got: ${output.trim().split('\n').join('\n         ')}`,
      why: expectation.why,
    });
  }
}

console.log(
  `[check:self] ${(manifest.expectedScriptFailures ?? []).length} artefact-gate fixture(s) run as subprocesses.`,
);

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\ncheck:self FAILED — ${failures.length} expected violation(s) were NOT caught:\n`);
  for (const failure of failures) {
    console.error(`  ${failure.what}`);
    console.error(`    fixture exists to prove: ${failure.why}\n`);
  }
  console.error(
    'A check that no longer catches its own fixture will not catch real content either.',
  );
  process.exit(1);
}

if (extra.length > 0) {
  console.log(`[check:self] note — ${extra.length} additional violation(s) beyond the manifest:`);
  for (const token of extra) console.log(`    ${token.replace('::', '  →  ')}`);
  console.log('  (not a failure; add them to expected-violations.json once deliberate.)');
}

console.log('[check:self] passed — every known-bad fixture was correctly rejected.');
