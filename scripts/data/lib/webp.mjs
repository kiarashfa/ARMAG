/**
 * WebP encoding, with the caps read from the same file `check:assets` reads.
 *
 * `src/data/thresholds.json` is the single source of the byte and pixel caps,
 * and of the "a file called `hero.webp` is the hero" rule. The encoder and the
 * gate must not each carry their own copy: an encoder targeting 200 KB while
 * the gate fails at 120 KB produces files that pass locally and break the
 * build, which is precisely the drift Phase 2 wrote that file to prevent.
 *
 * Encoding itself is `webp.py` — see its header for why it is Python.
 */
import { spawn } from 'node:child_process';
import { readFile, stat, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

const thresholds = JSON.parse(
  await readFile(path.join(REPO_ROOT, 'src', 'data', 'thresholds.json'), 'utf8'),
).assets;

export const ASSET_CAPS = thresholds;

/**
 * Which caps apply to a file, decided by its basename exactly as
 * `check:assets` decides it.
 */
export function capsForBasename(basename) {
  const isHero = basename.toLowerCase() === `hero.${thresholds.format}`;
  return isHero
    ? { role: 'hero', maxBytes: thresholds.heroMaxBytes, maxPixels: thresholds.heroMaxPixels }
    : {
        role: 'gallery',
        maxBytes: thresholds.galleryMaxBytes,
        maxPixels: thresholds.galleryMaxPixels,
      };
}

function runPython(args, stdin = null) {
  return new Promise((resolve, reject) => {
    // `python` rather than `python3`: this is a Windows-first repo
    // (Instruction.md §1) and `python3` is not on PATH there.
    const child = spawn('python', args, {
      // Console code page is 1256 on this machine and a Commons filename will
      // contain characters it cannot represent (Instruction.md §1).
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    if (stdin !== null) {
      child.stdin.on('error', () => {}); // a python that died early closes the pipe
      child.stdin.end(stdin, 'utf8');
    }
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (error) =>
      reject(
        new Error(
          `could not run python (${error.message}). The image pipeline needs Python with Pillow; ` +
            'it is authoring-time only and no part of the build or CI depends on it.',
        ),
      ),
    );
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || `python exited ${code}`));
    });
  });
}

/**
 * Tiles candidate images into one numbered contact sheet, for triage.
 *
 * `PLAYBOOK.md` §6 requires three searches per subject, so the agent routinely
 * has more candidates than it can afford to open. This writes one small sheet
 * instead; only the finalist is fetched at full size. Triage only — the tiles
 * cannot show a watermark or which variant a receiver is.
 *
 * Takes `[{ label, bytes }]` and returns what the tiler actually drew, so a
 * candidate that will not decode is reported rather than silently missing.
 */
export async function writeSheet(tiles, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  const job = JSON.stringify({
    out: destination,
    tiles: tiles.map(({ label, bytes }) => ({
      label,
      bytes_b64: Buffer.from(bytes).toString('base64'),
    })),
  });
  const script = path.join(REPO_ROOT, 'scripts', 'data', 'lib', 'sheet.py');
  const out = await runPython([script], job);
  return JSON.parse(out);
}

/**
 * Encodes `bytes` to WebP at `destination`, under that filename's caps.
 *
 * Returns the **measured** width, height and byte size of the file actually
 * written. Never the requested ones: Markey's whole first batch of image
 * dimensions was wrong because they were computed from the request rather than
 * read back from the file, and a `width` nobody measured is not a measurement
 * (the same sentence is in `check:assets`).
 */
export async function encodeToWebp(bytes, destination, { overwrite = false } = {}) {
  const caps = capsForBasename(path.basename(destination));
  await mkdir(path.dirname(destination), { recursive: true });

  const existing = await stat(destination).catch(() => null);
  if (existing && !overwrite) {
    throw new Error(
      `${destination} already exists (${Math.round(existing.size / 1024)} kB). ` +
        'The last argument is a filename, not a folder — use hero, or a descriptive name per image. ' +
        'SPEC.md §10: never re-encode in place; a changed image is a new filename.',
    );
  }

  const temp = `${destination}.source.tmp`;
  await writeFile(temp, bytes);
  try {
    const output = await runPython([
      path.join(REPO_ROOT, 'scripts', 'data', 'lib', 'webp.py'),
      temp,
      destination,
      '--max-px',
      String(caps.maxPixels),
      '--max-bytes',
      String(caps.maxBytes),
    ]);
    const result = JSON.parse(output);
    const measured = (await stat(destination)).size;
    if (measured > caps.maxBytes) {
      throw new Error(`encoded ${measured} bytes, over the ${caps.role} cap of ${caps.maxBytes}`);
    }
    return { ...result, bytes: measured, role: caps.role };
  } finally {
    await unlink(temp).catch(() => {});
  }
}
