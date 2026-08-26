/**
 * Build-time content integrity — SPEC.md §13 and §2 principle 8:
 * "The build fails loudly and completely."
 *
 * Hooks `astro:build:start` so broken content can never reach `dist/`, and
 * reports the **complete** list of violations rather than the first one, so
 * fixing content is one pass instead of a build-fix-build loop.
 *
 * The checks themselves live in `integrity-checks.ts`, framework-free, so the
 * standalone `check:content` and `check:self` scripts run exactly the same code
 * this integration does. Two implementations of the same gate would drift, and
 * the one that drifts is always the one CI runs.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AstroIntegration } from 'astro';

import { formatViolations, runIntegrityChecks } from './integrity-checks.ts';

export default function integrity(): AstroIntegration {
  let projectRoot = process.cwd();
  let srcDir = path.join(projectRoot, 'src');

  return {
    name: 'armag:integrity',
    hooks: {
      'astro:config:done': ({ config }) => {
        projectRoot = fileURLToPath(config.root);
        srcDir = fileURLToPath(config.srcDir);
      },
      'astro:build:start': async ({ logger }) => {
        const violations = await runIntegrityChecks({
          contentRoot: path.join(srcDir, 'content'),
          displayRoot: projectRoot,
        });

        if (violations.length > 0) {
          logger.error(`\n${formatViolations(violations)}`);
          throw new Error(
            `Content integrity failed: ${violations.length} violation(s). Nothing was written to dist/.`,
          );
        }

        logger.info('content integrity: no violations.');
      },
    },
  };
}
