#!/usr/bin/env node
/**
 * `npm run check:site` — assertions against the built output (SPEC.md §13).
 *
 * Runs after `astro build` and after Pagefind, because it checks the artefact
 * rather than the source. What is asserted here cannot be asserted anywhere
 * else: by the time these files exist, every integration, plugin and template
 * has had its say.
 *
 * ── In this phase ──────────────────────────────────────────────────────────
 *  - **Gate 6, the secret leak check.** A static site has no server to hide a
 *    key behind: anything that reaches `dist/` is published. The build fails if
 *    any value from `.env` appears anywhere in the output. The variable NAME is
 *    reported and the value never is, because a leak report that quotes the
 *    secret is a second leak.
 *  - The sitemap must not list a `NOINDEX_PATHS` page, asserted against the
 *    constant exported from `astro.config.ts` rather than a second copy of the
 *    list that could drift out of step with it.
 *
 * ── Phase 11 adds ──────────────────────────────────────────────────────────
 * The `/armory/` noindex triple condition, the JSON-LD rules (no `Product`, no
 * `Offer`, no `price`, no `availability`), and the Three.js fence. They are
 * listed in Instruction.md Phase 11 and need pages that do not exist yet;
 * stubbing them here as checks that pass would be exactly the green build
 * nobody is testing.
 *
 * Flags let `check:self` drive the gate against a fixture:
 *   --dist <dir>   default dist/
 *   --env <file>   default .env
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE, NOINDEX_PATHS } from '../../astro.config.ts';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
}

const distDir = path.resolve(root, flag('dist', 'dist'));
const envFile = path.resolve(root, flag('env', '.env'));

const failures = [];

if (!existsSync(distDir)) {
  console.error(`check:site FAILED — ${path.relative(root, distDir)} does not exist. Run the build first.`);
  process.exit(1);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const files = await walk(distDir);
const display = (file) => path.relative(root, file).split(path.sep).join('/');

// ---------------------------------------------------------------------------
// Gate 6 — no .env value may reach dist/
// ---------------------------------------------------------------------------

/**
 * Values short enough to occur by accident are skipped: a 4-character secret
 * would match half the hashed asset filenames on the site and the resulting
 * false alarm would train everyone to ignore this gate.
 */
const MIN_SECRET_LENGTH = 12;

const secrets = [];
if (existsSync(envFile)) {
  for (const line of (await readFile(envFile, 'utf8')).split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const name = match[1];
    const value = match[2].trim().replace(/^["']|["']$/g, '');
    if (value.length >= MIN_SECRET_LENGTH) secrets.push({ name, value });
  }
}

if (secrets.length > 0) {
  for (const file of files) {
    let content;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const secret of secrets) {
      if (content.includes(secret.value)) {
        // The name, never the value.
        failures.push(`${display(file)} contains the value of ${secret.name} from .env`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The sitemap must not invite a crawler to a noindex page — SPEC.md §12
// ---------------------------------------------------------------------------

const sitemaps = files.filter((f) => path.basename(f).startsWith('sitemap-'));
for (const sitemap of sitemaps) {
  const xml = await readFile(sitemap, 'utf8');
  for (const noindexPath of NOINDEX_PATHS) {
    if (xml.includes(`${BASE}${noindexPath}<`)) {
      failures.push(
        `${display(sitemap)} lists ${BASE}${noindexPath}, which is in NOINDEX_PATHS. A page carrying noindex must not also be advertised in the sitemap (SPEC.md §12)`,
      );
    }
  }
}

// ---------------------------------------------------------------------------

console.log(
  `[check:site] scanned ${files.length} built file(s); ${secrets.length} secret(s) from .env to look for.`,
);

if (failures.length > 0) {
  console.error(`\n${failures.length} site violation(s):\n`);
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('\ncheck:site FAILED');
  process.exit(1);
}

console.log('[check:site] passed.');
