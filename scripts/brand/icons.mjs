/**
 * App icons: apple-touch-icon, icon-192 and icon-512, drawn from this site's
 * own mark and palette.
 *
 *   npm run brand:icons             write every icon
 *   npm run brand:icons -- --check  exit 1 if a committed icon differs from
 *                                   what the current config would produce
 *
 * The social image is a separate generator: `npm run brand` (brand.ts).
 *
 * This file is the LAYOUT, kept free of anything site-specific. Everything
 * that belongs to the site (name, colours, fonts, the mark) lives in
 * `icons.config.mjs` beside it.
 *
 * The pipeline is satori (layout) followed by resvg (rasterisation). Both are
 * deterministic, which is what makes `--check` meaningful: the same config
 * always produces byte-identical PNGs.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import config from './icons.config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (p) => resolve(root, p);
const check = process.argv.includes('--check');

/* ── fonts ───────────────────────────────────────────────────────────────── */

const fonts = [];
for (const role of ['display', 'body']) {
  const { family, files } = config.fonts[role];
  for (const f of files) {
    fonts.push({
      name: family,
      data: readFileSync(at(f.path)),
      weight: f.weight,
      style: f.style ?? 'normal',
    });
  }
}

/* ── the mark, rasterised once per theme ────────────────────────────────── */

function markPng(theme, size) {
  const svg = config.mark(readFileSync(at('public/favicon.svg'), 'utf8'), theme);
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/* ── a tiny element helper, so the layout reads as a tree ────────────────── */

const h = (type, style, ...children) => ({
  type,
  props: {
    style: { display: 'flex', ...style },
    children: children.flat().filter((c) => c !== null),
  },
});
const img = (src, size, style = {}) => ({
  type: 'img',
  props: { src, width: size, height: size, style: { width: size, height: size, ...style } },
});

/* ── icons: the mark on the site's ground, with a padding per platform ───── */

async function icon(size, padding) {
  const inner = Math.round(size * (1 - 2 * padding));
  const tree = h(
    'div',
    {
      width: size,
      height: size,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: config.colors.background,
    },
    img(markPng(config.iconTheme ?? config.cardTheme, inner * 2), inner),
  );
  const svg = await satori(tree, { width: size, height: size, fonts });
  return new Resvg(svg, { fitTo: { mode: 'original' }, font: { loadSystemFonts: false } })
    .render()
    .asPng();
}

/* ── run ─────────────────────────────────────────────────────────────────── */

const outputs = {
  'public/apple-touch-icon.png': await icon(180, 0.1),
  'public/icon-192.png': await icon(192, 0.06),
  'public/icon-512.png': await icon(512, 0.06),
};

let stale = 0;
for (const [path, png] of Object.entries(outputs)) {
  if (check) {
    let current = null;
    try {
      current = readFileSync(at(path));
    } catch {}
    if (!current || !current.equals(png)) {
      stale++;
      console.log(`stale   ${path}`);
    } else console.log(`ok      ${path}`);
  } else {
    mkdirSync(dirname(at(path)), { recursive: true });
    writeFileSync(at(path), png);
    console.log(`wrote   ${path}  (${(png.length / 1024).toFixed(0)} kB)`);
  }
}

if (stale) process.exit(1);
