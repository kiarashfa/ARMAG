#!/usr/bin/env node
/**
 * `npm run check:content` — the content-integrity gate (SPEC.md §13).
 *
 * Runs the same checks `astro build` runs, but standalone and ahead of it, so
 * a content error costs a second rather than a full build. Reports every
 * violation at once and exits non-zero if there are any.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatViolations, runIntegrityChecks } from '../../src/integrations/integrity-checks.ts';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const violations = await runIntegrityChecks({
  contentRoot: path.join(root, 'src', 'content'),
  displayRoot: root,
});

if (violations.length > 0) {
  console.error(`\n${formatViolations(violations)}`);
  console.error('check:content FAILED');
  process.exit(1);
}

console.log('[check:content] passed — no integrity violations.');
