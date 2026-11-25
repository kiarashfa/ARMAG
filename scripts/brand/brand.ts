/**
 * Social card generator: writes the one image used for link previews (Open Graph, X, Slack, ...)
 * and for the GitHub repository social preview.
 *
 *   npm run brand        (or: node scripts/brand/brand.ts)
 *
 * What changes from site to site lives in `brand.config.ts` beside this file: the name, the
 * creative line, the two colours, the icon and the fonts. This file is the shared layout and
 * should stay identical in every repository.
 *
 * Layout: dark base, two soft glows from the icon colours, whole-card depth lights, a white halo
 * behind the icon tile, three nested diamonds, short fading rules, then the wordmark, one line and
 * the promise. Everything that must stay readable sits inside x 80..1200, y 112..528 of the 1280 x
 * 640 canvas, because GitHub's topics page shows only y 80..560 and Facebook and LinkedIn trim
 * about 30 px from each side.
 *
 * It renders with Google Chrome through playwright-core (set CHROME_PATH to use another binary),
 * with the fonts embedded from the files named in the config, so the result does not depend on
 * what is installed on the machine. Plain Node type stripping runs it (Node 22.18 or newer).
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './brand.config.ts';

export interface BrandFont {
  /** Family name used in `wordmark` and `bodyFont`. */
  family: string;
  /** Font file (woff or woff2), relative to the package root. */
  file: string;
  /** A number, or a range such as '100 900' for a variable font. */
  weight: number | string;
  style?: 'normal' | 'italic';
}

export interface BrandConfig {
  /** Plain name, used for the page title and messages. */
  name: string;
  /** The wordmark as HTML, set in the fonts below. Wrap an accent letter in a span with a colour. */
  wordmark: string;
  /** Starting font size of the wordmark in px; it shrinks to fit 620 px. Default 150. */
  wordmarkSize?: number;
  /** One short creative line, specific to this project. */
  line: string;
  /** The promise under it. Default: 'Free, without ads, and no signup'. */
  promise?: string;
  /** Dark base colour of the card. */
  background: string;
  /** Main accent: rules, diamonds, first glow, lights. */
  primary: string;
  /** Second colour: second glow and some lights. */
  secondary: string;
  /** Text colour. Default '#f4f1ea'. */
  ink?: string;
  /** Icon tile: a square PNG or an SVG, relative to the package root. */
  icon: string;
  /** Background behind a transparent icon. Default: none. */
  iconBackground?: string;
  /** Padding inside that background as a fraction of the tile (0.18 = 18 %). Default 0. */
  iconPadding?: number;
  /** Family used for the line and the promise (must be listed in `fonts`). */
  bodyFont: string;
  fonts: BrandFont[];
  /** Output file relative to the package root. Default 'public/og-image.jpg'. */
  output?: string;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (p: string) => resolve(root, p);
const cfg = config as BrandConfig;
const primary = cfg.primary;
const secondary = cfg.secondary;
const ink = cfg.ink ?? '#f4f1ea';
const output = cfg.output ?? 'public/og-image.jpg';
const promise = cfg.promise ?? 'Free, without ads, and no signup';

const CX = 985;
const CY = 320;
const YT = 92;
const YB = 548;

const dataUrl = (file: string, mime: string) => {
  if (!existsSync(at(file))) throw new Error(`brand: file not found: ${file}`);
  return `data:${mime};base64,${readFileSync(at(file)).toString('base64')}`;
};
const MIME: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
};

const fontCss = cfg.fonts
  .map(
    (f) =>
      `@font-face{font-family:'${f.family}';src:url('${dataUrl(f.file, MIME[extname(f.file)] ?? 'font/woff2')}');font-weight:${f.weight};font-style:${f.style ?? 'normal'}}`,
  )
  .join('\n');

const svgWrap = (inner: string) =>
  `<svg width="1280" height="640" viewBox="0 0 1280 640" xmlns="http://www.w3.org/2000/svg" style="position:absolute;left:0;top:0">${inner}</svg>`;
let gid = 0;
const rule = (y: number, x0: number, x1: number, w = 1.4, hold = 0.25) => {
  const id = `rg${gid++}`;
  return `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x0}" x2="${x1}" y1="0" y2="0"><stop offset="0" stop-color="${primary}" stop-opacity=".9"/><stop offset="${hold}" stop-color="${primary}" stop-opacity=".77"/><stop offset="1" stop-color="${primary}" stop-opacity="0"/></linearGradient></defs><rect x="${Math.min(x0, x1)}" y="${y}" width="${Math.abs(x1 - x0)}" height="${w}" fill="url(#${id})"/>`;
};
const rules = svgWrap(
  rule(YT - 4, 0, 700, 1.2, 0.2) + rule(YT + 2, 0, 504, 2.4, 0.2) + rule(YB, 0, 400, 1.6, 0.15),
);
const diamonds = svgWrap(
  [160, 225, 290]
    .map(
      (d, i) =>
        `<rect x="${CX - d}" y="${CY - d}" width="${d * 2}" height="${d * 2}" transform="rotate(45 ${CX} ${CY})" fill="none" stroke="${primary}" stroke-opacity="${(0.5 - i * 0.12).toFixed(2)}" stroke-width="${i === 0 ? 1.8 : 1.2}"/>`,
    )
    .join(''),
);

const mix = (hex: string, to: string, t: number) => {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(to.slice(i, i + 2), 16));
  return (
    '#' +
    a
      .map((v, i) =>
        Math.round(v + (b[i] - v) * t)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
};

let state = 1;
const rand = () => (state = (state * 16807) % 2147483647) / 2147483647;
const lights = () => {
  const colours = [primary, primary, secondary, mix(primary, '#ffffff', 0.5)];
  const mask =
    'mask-image:linear-gradient(90deg,rgba(0,0,0,.35) 0%,rgba(0,0,0,.35) 42%,#000 68%);-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,.35) 0%,rgba(0,0,0,.35) 42%,#000 68%)';
  const disc = (x: number, y: number, r: number, c: string, a: number, blur: number) =>
    `<div style="position:absolute;left:${(x - r).toFixed(0)}px;top:${(y - r).toFixed(0)}px;width:${(2 * r).toFixed(0)}px;height:${(2 * r).toFixed(0)}px;border-radius:50%;background:radial-gradient(closest-side,${c}d0 0%,${c}88 68%,${c}22 92%,transparent 100%);filter:blur(${blur.toFixed(1)}px);opacity:${a.toFixed(2)};mix-blend-mode:screen"></div>`;
  const layer = (
    n: number,
    place: (i: number) => number[],
    r0: number,
    r1: number,
    a0: number,
    a1: number,
    b0: number,
    b1: number,
    skew: number,
    seed: number,
  ) => {
    state = seed;
    let out = '';
    for (let i = 0; i < n; i++) {
      const [x, y] = place(i);
      const r = r0 + Math.pow(rand(), skew) * (r1 - r0);
      out += disc(
        x,
        y,
        r,
        colours[Math.floor(rand() * colours.length)],
        a0 + rand() * (a1 - a0),
        b0 + rand() * (b1 - b0),
      );
    }
    return out;
  };
  const edges = [
    [60, 40],
    [640, -10],
    [1230, 60],
    [1250, 600],
    [640, 650],
    [40, 600],
    [-10, 330],
  ];
  const anywhere = (y0: number, y1: number) => () => [rand() * 1280, y0 + rand() * (y1 - y0)];
  return `<div style="position:absolute;inset:0;${mask}">${layer(7, (i) => edges[i], 120, 210, 0.22, 0.33, 26, 34, 1, 6)}${layer(26, anywhere(0, 640), 20, 52, 0.28, 0.55, 6, 9, 1.6, 8)}${layer(40, anywhere(20, 620), 3, 9, 0.6, 0.95, 0, 1, 1, 10)}</div>`;
};

const noise = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .55 0'/></filter><rect width='300' height='300' filter='url(%23n)'/></svg>")`;

const size = 250;
const pad = cfg.iconPadding ? Math.round(size * cfg.iconPadding) : 0;
const iconTile = `<div data-keep style="position:absolute;left:${CX - size / 2}px;top:${CY - size / 2}px;width:${size}px;height:${size}px;border-radius:22%;overflow:hidden;box-shadow:0 12px 30px #0008;background:${cfg.iconBackground ?? 'transparent'};padding:${pad}px;box-sizing:border-box"><img src="${dataUrl(cfg.icon, MIME[extname(cfg.icon)] ?? 'image/png')}" style="display:block;width:100%;height:100%"></div>`;

const html = `<!doctype html><meta charset="utf-8"><title>${cfg.name}</title><style>${fontCss}
html,body{margin:0;background:${cfg.background}} .grain{position:absolute;inset:0;background-image:${noise}}
.c{position:relative;width:1280px;height:640px;overflow:hidden;background:${cfg.background}}</style>
<div class="c">
  <div style="position:absolute;left:-200px;top:-260px;width:820px;height:820px;border-radius:50%;background:radial-gradient(closest-side,${primary}40,transparent);filter:blur(24px)"></div>
  <div style="position:absolute;right:-220px;bottom:-300px;width:860px;height:860px;border-radius:50%;background:radial-gradient(closest-side,${secondary}55,transparent);filter:blur(24px)"></div>
  ${lights()}
  ${diamonds}
  ${rules}
  <div class="grain" style="opacity:.14;mix-blend-mode:overlay"></div>
  <div style="position:absolute;left:${CX - 330}px;top:${CY - 330}px;width:660px;height:660px;border-radius:50%;background:radial-gradient(closest-side,rgba(255,255,255,.2) 0%,rgba(255,255,255,.067) 45%,transparent 100%)"></div>
  ${iconTile}
  <div style="position:absolute;left:80px;top:112px;width:640px;height:416px;display:flex;flex-direction:column;justify-content:center;gap:22px">
    <div data-keep data-fit="620" style="font-size:${cfg.wordmarkSize ?? 150}px;line-height:1.05;color:${ink};white-space:nowrap;align-self:flex-start">${cfg.wordmark}</div>
    <div data-keep style="font-family:'${cfg.bodyFont}';font-weight:500;font-size:40px;line-height:1.25;color:${ink};opacity:.92;max-width:620px;text-wrap:balance">${cfg.line}</div>
    <div style="height:6px"></div>
    <div data-keep style="font-family:'${cfg.bodyFont}';font-weight:400;font-size:26px;letter-spacing:.01em;color:#c9ccd2;opacity:.8;white-space:nowrap">${promise}</div>
  </div>
</div>
<script>for(const e of document.querySelectorAll('[data-fit]')){const m=+e.dataset.fit;let f=parseFloat(e.style.fontSize);e.style.display='inline-block';while(e.getBoundingClientRect().width>m&&f>56){f-=2;e.style.fontSize=f+'px'}}</script>`;

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' },
);
try {
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 })
  ).newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);

  // Safe zone: everything that must stay readable has to sit inside x 80..1200, y 112..528.
  const boxes: number[][] = await page.evaluate(() =>
    [...document.querySelectorAll('[data-keep]')].map((e) => {
      const r =
        e.tagName === 'DIV' && e.querySelector('img')
          ? e.getBoundingClientRect()
          : (() => {
              const g = document.createRange();
              g.selectNodeContents(e);
              return g.getBoundingClientRect();
            })();
      return [r.left, r.top, r.right, r.bottom].map(Math.round);
    }),
  );
  const left = Math.min(...boxes.map((b) => b[0]));
  const top = Math.min(...boxes.map((b) => b[1]));
  const right = Math.max(...boxes.map((b) => b[2]));
  const bottom = Math.max(...boxes.map((b) => b[3]));
  const margin = 4;
  if (left < 80 - margin || top < 112 - margin || right > 1200 + margin || bottom > 528 + margin) {
    throw new Error(
      `brand: content leaves the safe zone (x 80..1200, y 112..528): ${left},${top},${right},${bottom}. Shorten the line or lower wordmarkSize.`,
    );
  }

  mkdirSync(dirname(at(output)), { recursive: true });
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 92 });
  writeFileSync(at(output), jpeg);
  const kb = Math.round(statSync(at(output)).size / 1024);
  console.log(
    `brand: wrote ${output} (${kb} kB), content ${left},${top},${right},${bottom} inside the safe zone`,
  );
  if (kb > 900) console.warn('brand: file is over 900 kB; GitHub accepts at most 1 MB');
} finally {
  await browser.close();
}
