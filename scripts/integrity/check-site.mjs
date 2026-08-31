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
 *  - **The noindex triple, all three legs at once** (SPEC.md §12). Every path
 *    in `NOINDEX_PATHS` must carry `noindex` in its own head, must be absent
 *    from the sitemap, and must **not** be disallowed in `robots.txt`. The
 *    third leg is the counter-intuitive one and the reason the other two are
 *    checked with it: a blocked page is never fetched, so its `noindex` is
 *    never read, and it can sit in the index as "fetched but not indexed"
 *    indefinitely. Asserting them separately would let a well-meaning
 *    `Disallow:` pass review.
 *
 *  - **The JSON-LD rules** (SPEC.md §12). Every `application/ld+json` block
 *    must parse, and none may carry `Product`, `Offer`, `price` or
 *    `availability`. The same walk runs inside `json-ld.ts` and throws while
 *    the page is being built; this one catches a node that reached `dist/` by
 *    any other route, including hand-written markup in an `.mdx`.
 *  - **The Three.js fence** (SPEC.md §3, §11). The v2 shooting range is the
 *    one thing on this site allowed to ship a 3D engine, and it is allowed to
 *    ship it only under `/guns/<slug>/range/`. No such page exists in v1, so
 *    the fence is currently absolute: a WebGL renderer anywhere in `dist/`
 *    fails the build.
 *  - **The per-page JS budget** (SPEC.md §11, "stated so they are
 *    checkable"). The module graph is followed transitively from each page,
 *    because a page's cost is what it loads, not what it names.
 *  - **Internal links resolve.** Every `href` into the site must land on a
 *    file that was actually built. This is the gate the crosslink plugins
 *    need: they mint links from content data, so a link to a page that does
 *    not exist is a build product, not a typo, and nothing else would catch
 *    it.
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
import { commerceViolations } from '../../src/lib/render/json-ld.ts';
import thresholds from '../../src/data/thresholds.json' with { type: 'json' };

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
}

const distDir = path.resolve(root, flag('dist', 'dist'));
const envFile = path.resolve(root, flag('env', '.env'));
const jsBudgetBytes = Number(flag('js-budget-bytes', thresholds.site.jsBudgetBytes));

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
// The noindex triple — SPEC.md §12, Instruction.md Phase 7
// ---------------------------------------------------------------------------

const robotsFile = path.join(distDir, 'robots.txt');
const robots = existsSync(robotsFile) ? await readFile(robotsFile, 'utf8') : null;

if (robots === null) {
  failures.push(
    'dist/robots.txt is missing. The noindex triple cannot be asserted without it, and a check that passes because its subject does not exist is not a check (SPEC.md §12)',
  );
}

const disallowed = (robots ?? '')
  .split(/\r?\n/)
  .map((line) => /^\s*Disallow:\s*(\S*)/i.exec(line))
  .filter((match) => match !== null)
  .map((match) => match[1]);

for (const noindexPath of NOINDEX_PATHS) {
  const url = `${BASE}${noindexPath}`;

  // Leg 1 — the page says noindex in its own head.
  const page = path.join(distDir, noindexPath.replace(/^\//, ''), 'index.html');
  if (!existsSync(page)) {
    failures.push(
      `${noindexPath} is in NOINDEX_PATHS but no page was built at ${display(page)}. A path that carries no page cannot carry a noindex either`,
    );
  } else {
    const html = await readFile(page, 'utf8');
    if (!/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html)) {
      failures.push(`${display(page)} does not carry a noindex robots meta tag (SPEC.md §12)`);
    }
  }

  // Leg 2 — the sitemap does not advertise it. (Asserted above as well, against
  // the sitemap files; repeated here so the triple reads as one rule.)

  // Leg 3 — robots.txt does not block it, which is what makes leg 1 work.
  for (const rule of disallowed) {
    if (rule !== '' && (url.startsWith(rule) || rule.startsWith(url))) {
      failures.push(
        `robots.txt disallows ${rule}, which covers ${url}. A blocked page is never fetched, so its noindex is never read and it can stay indexed as "fetched but not indexed" forever. Exclude it from the sitemap instead — it already is (SPEC.md §12)`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// JSON-LD — SPEC.md §12
// ---------------------------------------------------------------------------

const htmlFiles = files.filter((file) => file.endsWith('.html'));
const htmlSource = new Map();
for (const file of htmlFiles) htmlSource.set(file, await readFile(file, 'utf8'));

const LD_BLOCK = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

let jsonLdBlocks = 0;
for (const [file, html] of htmlSource) {
  LD_BLOCK.lastIndex = 0;
  let match;
  while ((match = LD_BLOCK.exec(html)) !== null) {
    jsonLdBlocks++;
    let node;
    try {
      node = JSON.parse(match[1]);
    } catch (error) {
      failures.push(`${display(file)} carries JSON-LD that is not valid JSON: ${error.message}`);
      continue;
    }
    for (const violation of commerceViolations(node)) {
      failures.push(
        `${display(file)} JSON-LD ${violation}. SPEC.md §12 forbids Product, Offer, price and availability outright — these are encyclopedia entries, not listings`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The Three.js fence — SPEC.md §3 and §11
// ---------------------------------------------------------------------------

/**
 * Identifiers no bundle can carry without being a 3D engine.
 *
 * Deliberately narrow: the *word* "three" appears in prose on half the site,
 * and a fence that fired on it would be switched off within a week.
 */
const THREE_MARKERS = ['WebGLRenderer', 'THREE.Scene', 'PerspectiveCamera', 'three.module.js'];

/** The one place a 3D engine is allowed to land — SPEC.md §9.8. v2. */
const RANGE_PATH = /\/guns\/[^/]+\/range\//;

for (const file of files) {
  if (!/\.(js|mjs|html)$/.test(file)) continue;
  const url = `/${path.relative(distDir, file).split(path.sep).join('/')}`;
  if (RANGE_PATH.test(url)) continue;
  let content;
  try {
    content = await readFile(file, 'utf8');
  } catch {
    continue;
  }
  for (const marker of THREE_MARKERS) {
    if (content.includes(marker)) {
      failures.push(
        `${display(file)} contains "${marker}", i.e. a 3D engine outside /guns/<slug>/range/. SPEC.md §11 fences Three.js to the v2 shooting range so it can never become part of a spec page's JS budget`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The per-page JS budget — SPEC.md §11
// ---------------------------------------------------------------------------

const ASSET_REF = /["'`(]([^"'`()\s]*\/_astro\/[A-Za-z0-9_.-]+\.js)["'`)]/g;
const RELATIVE_REF = /["'`](\.\/[A-Za-z0-9_.-]+\.js)["'`]/g;

const bytesOf = new Map();
for (const file of files) {
  if (file.endsWith('.js')) bytesOf.set(file, (await readFile(file)).byteLength);
}

const toAsset = (ref) => path.join(distDir, ref.replace(/^.*\/_astro\//, '_astro/'));

/** Every module a page pulls in, followed transitively. */
async function moduleGraph(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !bytesOf.has(file)) continue;
    seen.add(file);
    const source = await readFile(file, 'utf8');
    for (const [, ref] of source.matchAll(ASSET_REF)) queue.push(toAsset(ref));
    for (const [, ref] of source.matchAll(RELATIVE_REF)) {
      queue.push(path.resolve(path.dirname(file), ref));
    }
  }
  return seen;
}

/**
 * `/armory/` is exempt, and the reason is on the record (CLAUDE.md item 142):
 * it validates a hostile input — a blob that may have been hand-edited or
 * restored from someone else's backup — with the *same* Zod schema the rest of
 * the site is built on, and about 60 kB of its weight is that schema. A
 * hand-written client validator would be smaller and would drift from the real
 * one, which is a worse failure than the budget it saves.
 */
const budgetExempt = thresholds.site.jsBudgetExemptPaths;

const jsWeights = [];
for (const [file, html] of htmlSource) {
  const url = `/${path.relative(distDir, file).split(path.sep).join('/')}`.replace(
    /index\.html$/,
    '',
  );
  const entries = [...new Set([...html.matchAll(ASSET_REF)].map(([, ref]) => toAsset(ref)))];
  const graph = await moduleGraph(entries);
  let bytes = 0;
  for (const module of graph) bytes += bytesOf.get(module) ?? 0;
  // Inline scripts are part of what the page costs to run, so they count.
  for (const [, inline] of html.matchAll(
    /<script(?![^>]*(?:src=|type=["']application\/ld\+json["']))[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    bytes += Buffer.byteLength(inline, 'utf8');
  }

  jsWeights.push({ url, bytes });
  const relative = url.startsWith(BASE) ? url.slice(BASE.length) || '/' : url;
  if (bytes > jsBudgetBytes && !budgetExempt.includes(relative)) {
    failures.push(
      `${display(file)} loads ${(bytes / 1024).toFixed(1)} kB of JavaScript, over the ${(
        jsBudgetBytes / 1024
      ).toFixed(0)} kB per-page budget in SPEC.md §11`,
    );
  }
}

jsWeights.sort((a, b) => b.bytes - a.bytes);

// ---------------------------------------------------------------------------
// Every internal link must resolve to something that was built
// ---------------------------------------------------------------------------

/**
 * The crosslink plugins mint links from the content files, so a link to a page
 * that does not exist is a build product rather than a typo, and no other gate
 * would see it. Checked against `dist/` rather than against the route list,
 * because what a reader can click is what was written to disk.
 */
const built = new Set(
  files.map((file) => `/${path.relative(distDir, file).split(path.sep).join('/')}`),
);

const HREF = /href=["']([^"']+)["']/g;
const brokenLinks = new Map();
let internalLinks = 0;

for (const [file, html] of htmlSource) {
  for (const [, raw] of html.matchAll(HREF)) {
    if (!raw.startsWith('/')) continue;
    const target = raw.split('#')[0].split('?')[0];
    if (target === '') continue;
    if (BASE && !target.startsWith(`${BASE}/`) && target !== BASE) continue;
    internalLinks++;
    // `dist/` is NOT nested under the base path — Astro writes `dist/guns/...`
    // while the page links to `/ARMAG/guns/...` — so the base comes off before
    // the path is looked up. Missing this made every internal link on the site
    // report as broken, which is the shape of failure that gets a gate deleted.
    const rel = target === BASE ? '/' : target.slice(BASE.length);
    const resolved = rel.endsWith('/') ? `${rel}index.html` : rel;
    if (built.has(resolved)) continue;
    // A path with no extension and no trailing slash may still be a directory.
    if (!path.extname(resolved) && built.has(`${resolved}/index.html`)) continue;
    const list = brokenLinks.get(target) ?? [];
    list.push(display(file));
    brokenLinks.set(target, list);
  }
}

for (const [target, pages] of brokenLinks) {
  failures.push(
    `${target} is linked from ${pages.length} page(s) — e.g. ${pages[0]} — and nothing was built there`,
  );
}

// ---------------------------------------------------------------------------

console.log(
  `[check:site] scanned ${files.length} built file(s); ${secrets.length} secret(s) from .env to look for; ` +
    `${NOINDEX_PATHS.length} noindex path(s) checked on all three legs; ${jsonLdBlocks} JSON-LD block(s); ` +
    `${internalLinks} internal link(s) resolved.`,
);
if (jsWeights.length > 0) {
  const heaviest = jsWeights[0];
  console.log(
    `[check:site] heaviest page by JavaScript: ${heaviest.url} at ${(heaviest.bytes / 1024).toFixed(
      1,
    )} kB (budget ${(jsBudgetBytes / 1024).toFixed(0)} kB, SPEC.md §11).`,
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} site violation(s):\n`);
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('\ncheck:site FAILED');
  process.exit(1);
}

console.log('[check:site] passed.');
