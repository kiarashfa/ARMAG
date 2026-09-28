/**
 * Writes the 800px copy of every stored photograph into the build output.
 *
 * The copies exist only in `dist/`: the repository keeps one file per
 * photograph, and the build derives the rest, so the image budget and the
 * repository size are unchanged. Pages reference them through `srcsetFor()`,
 * which applies the same width threshold, so a `srcset` never names a file
 * that was not written.
 */
import type { AstroIntegration } from 'astro';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { DERIVATIVE_FROM, DERIVATIVE_WIDTH, derivativeOf } from '../lib/content/srcset.ts';

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.webp$/i.test(entry.name) && !/\.w\d+\.webp$/i.test(entry.name)) yield path;
  }
}

export default function responsiveImages(): AstroIntegration {
  return {
    name: 'responsive-images',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = join(fileURLToPath(dir), 'images');
        if (!(await stat(root).catch(() => null))) return;
        let written = 0;
        let saved = 0;
        for await (const file of walk(root)) {
          const { width } = await sharp(file).metadata();
          if (!width || width <= DERIVATIVE_FROM) continue;
          const out = derivativeOf(file);
          const info = await sharp(file).resize({ width: DERIVATIVE_WIDTH }).webp({ quality: 76, effort: 5 }).toFile(out);
          written++;
          saved += (await stat(file)).size - info.size;
        }
        logger.info(`${written} photographs got an ${DERIVATIVE_WIDTH}px copy (${Math.round(saved / 1024 / 1024)} MB less for pages that use it).`);
      },
    },
  };
}
