#!/usr/bin/env node
/**
 * `npm run check:assets` — the image budget gate (SPEC.md §10, §13 gate 5).
 *
 * Two jobs, and the second is the one that matters:
 *
 *  1. Per-file caps. Format, byte size and pixel dimensions, read from the
 *     WebP header rather than trusted from a JSON field, because a `width`
 *     nobody measured is not a measurement.
 *  2. **A running total.** Per-file caps alone do not bound anything — a
 *     thousand individually compliant files still overrun a 1 GB Pages site.
 *     Usage is printed on every build, warns at 600 MB and fails at 750 MB, so
 *     the ceiling arrives as a trend rather than as a surprise. SPEC.md §10
 *     pre-plans the escape hatch: images move to a second `gun-assets`
 *     repository behind `assetUrl()`, which is a one-line change.
 *
 * Hero and gallery are told apart by filename: `hero.webp` is the hero, every
 * other file is gallery. Stated in `src/data/thresholds.json` so the Phase 9
 * image fetcher and this gate cannot disagree about it.
 *
 * Flags exist so `check:self` can point the gate at a fixture tree with caps
 * small enough that a few hundred bytes is an overrun — otherwise proving the
 * gate still bites would mean committing an oversized binary forever.
 *
 *   --root <dir>            default public/images
 *   --hero-max-bytes N
 *   --gallery-max-bytes N
 *   --total-warn-bytes N
 *   --total-fail-bytes N
 *   --quiet                 print only failures
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const thresholds = JSON.parse(
  await readFile(path.join(root, 'src', 'data', 'thresholds.json'), 'utf8'),
).assets;

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
}
const quiet = argv.includes('--quiet');

const assetRoot = path.resolve(root, flag('root', path.join('public', 'images')));
const caps = {
  heroMaxBytes: Number(flag('hero-max-bytes', thresholds.heroMaxBytes)),
  heroMaxPixels: Number(flag('hero-max-pixels', thresholds.heroMaxPixels)),
  galleryMaxBytes: Number(flag('gallery-max-bytes', thresholds.galleryMaxBytes)),
  galleryMaxPixels: Number(flag('gallery-max-pixels', thresholds.galleryMaxPixels)),
  totalWarnBytes: Number(flag('total-warn-bytes', thresholds.totalWarnBytes)),
  totalFailBytes: Number(flag('total-fail-bytes', thresholds.totalFailBytes)),
};

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

/**
 * Canvas dimensions from a WebP header — the three chunk layouts a WebP can
 * actually use. Returns `null` for anything that is not a WebP, which the
 * format check reports separately.
 */
function webpDimensions(buffer) {
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    const read24 = (offset) =>
      buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
    return { width: read24(24) + 1, height: read24(27) + 1 };
  }
  return null;
}

async function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const files = await walk(assetRoot);
const failures = [];
let total = 0;

for (const file of files) {
  const display = path.relative(root, file).split(path.sep).join('/');
  const size = (await stat(file)).size;
  total += size;

  if (path.extname(file).toLowerCase() !== `.${thresholds.format}`) {
    failures.push(`${display}: not ${thresholds.format} — SPEC.md §10 is WebP only`);
    continue;
  }

  const isHero = path.basename(file).toLowerCase() === `hero.${thresholds.format}`;
  const maxBytes = isHero ? caps.heroMaxBytes : caps.galleryMaxBytes;
  const maxPixels = isHero ? caps.heroMaxPixels : caps.galleryMaxPixels;
  const role = isHero ? 'hero' : 'gallery';

  if (size > maxBytes) {
    failures.push(`${display}: ${kb(size)} exceeds the ${role} cap of ${kb(maxBytes)}`);
  }

  const dimensions = webpDimensions(await readFile(file));
  if (!dimensions) {
    failures.push(`${display}: cannot read a WebP header — is it really a WebP?`);
  } else {
    const longest = Math.max(dimensions.width, dimensions.height);
    if (longest > maxPixels) {
      failures.push(
        `${display}: ${dimensions.width}×${dimensions.height} exceeds the ${role} cap of ${maxPixels}px on the long edge`,
      );
    }
  }
}

const overWarn = total > caps.totalWarnBytes;
const overFail = total > caps.totalFailBytes;

if (!quiet) {
  console.log(
    `[check:assets] ${files.length} file(s), ${mb(total)} of ${mb(caps.totalFailBytes)} budget (${((total / caps.totalFailBytes) * 100).toFixed(1)}%).`,
  );
}

if (overFail) {
  failures.push(
    `TOTAL ${mb(total)} exceeds the hard budget of ${mb(caps.totalFailBytes)} — move images to the second assets repository behind assetUrl() (SPEC.md §10)`,
  );
} else if (overWarn) {
  console.warn(
    `[check:assets] WARNING — ${mb(total)} is past the ${mb(caps.totalWarnBytes)} warn threshold. Instruction.md §5 says escalate at this point rather than at the hard limit.`,
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} asset budget violation(s):\n`);
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('\ncheck:assets FAILED');
  process.exit(1);
}

if (!quiet) console.log('[check:assets] passed.');
