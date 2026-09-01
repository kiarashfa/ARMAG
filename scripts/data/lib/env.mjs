/**
 * Reads `.env` for the authoring pipeline.
 *
 * No dependency: the file is `NAME=value` lines and a five-line parser is
 * smaller than the argument for adding `dotenv` to a project whose build never
 * runs this code.
 *
 * `.env` is gitignored and authoring-time only — `scripts/data/` never runs in
 * `astro build`, `npm test` or CI, which is why a missing key here is a normal
 * condition on a clean checkout rather than a broken build. `requireKey` says
 * which variable is missing and never prints a value: `check:site` fails the
 * build if any `.env` value reaches `dist/`, and a log line that quotes a
 * secret is the same leak by another route.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

let cache = null;

function load() {
  if (cache) return cache;
  cache = { ...process.env };
  const file = path.join(REPO_ROOT, '.env');
  if (!existsSync(file)) return cache;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    // A value already in the real environment wins, so a shell can override.
    if (cache[match[1]]) continue;
    cache[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return cache;
}

/** The key, or a throw naming the variable. Never prints the value. */
export function requireKey(name, what) {
  const value = load()[name];
  if (!value) {
    throw new Error(
      `${name} is not set. It lives in .env at the repository root (gitignored, authoring-time only) ` +
        `and is what ${what} needs. Ask Kiarash for it rather than working around it.`,
    );
  }
  return value;
}

export const hasKey = (name) => Boolean(load()[name]);
