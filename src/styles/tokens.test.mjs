/**
 * Design-token invariants — SPEC.md §11, Instruction.md Phase 1.
 *
 * Three things are asserted here, and all three are the kind of mistake that
 * is invisible until someone with low vision, or a bright room, finds it:
 *
 *  1. Every colour token is a PAIR — defined in both themes, with a different
 *     value in each. A token defined in one theme only inherits whatever the
 *     other theme happened to leave in the variable; the same value in both is
 *     a token that was never actually themed.
 *  2. Every text foreground clears WCAG AA (4.5:1) on every surface it can
 *     land on — including `surface-3` and the type tints, which is where muted
 *     text usually sits and where a "good enough on the page background"
 *     value fails.
 *  3. `line-strong` clears 3:1 (WCAG 1.4.11) on the surfaces it borders.
 *
 * The maths is done here rather than trusted to a browser because this has to
 * run in CI, in the gated build, on every change to the palette — which is the
 * only way a token edit six months from now cannot quietly break AA.
 *
 * `oklch()` values are converted Oklch -> Oklab -> linear sRGB -> sRGB,
 * clamped to gamut the way a display clamps them, then relinearised for the
 * WCAG relative-luminance formula.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const CSS = readFileSync(new URL('./global.css', import.meta.url), 'utf8');

/* ── Colour maths ─────────────────────────────────────────────────────────── */

function parseOklch(value) {
  const m = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value.trim());
  if (!m) return null;
  return { L: Number(m[1]) / 100, C: Number(m[2]), h: Number(m[3]) };
}

/** Oklch -> linear sRGB (Björn Ottosson's coefficients). */
function oklchToLinearRgb({ L, C, h }) {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const encode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const decode = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const clamp01 = (c) => Math.min(1, Math.max(0, c));

/**
 * WCAG relative luminance of an oklch colour, as actually displayed: encoded
 * to sRGB and clamped to gamut first, because a value the display cannot show
 * is not the value the reader sees.
 */
function luminance(oklch) {
  const [r, g, b] = oklchToLinearRgb(oklch).map((c) => decode(clamp01(encode(c))));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/* ── Token extraction ─────────────────────────────────────────────────────── */

/** Comments are stripped first so a brace inside prose cannot end a block. */
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

function colorTokensIn(blockRe, label) {
  const tokens = new Map();
  let block;
  let found = false;
  blockRe.lastIndex = 0;
  while ((block = blockRe.exec(CSS_NO_COMMENTS)) !== null) {
    found = true;
    for (const [, name, value] of block[1].matchAll(/(--color-[\w-]+)\s*:\s*([^;]+);/g)) {
      const oklch = parseOklch(value);
      if (oklch) tokens.set(name, { raw: value.trim(), oklch });
    }
  }
  assert.ok(found, 'No CSS block matched ' + label + ' in global.css');
  return tokens;
}

const DARK = colorTokensIn(/@theme\s*\{([^{}]*)\}/g, '@theme');
const LIGHT = colorTokensIn(/\[data-theme='light'\]\s*\{([^{}]*)\}/g, "[data-theme='light']");
const THEMES = { dark: DARK, light: LIGHT };

/* ── What must hold ───────────────────────────────────────────────────────── */

const SURFACES = ['--color-surface-0', '--color-surface-1', '--color-surface-2', '--color-surface-3'];

const TYPES = ['handgun', 'rifle', 'shotgun', 'smg', 'machinegun', 'platform'];

/**
 * Every token that carries TEXT. Each must clear AA on every surface, because
 * the surface a given label sits on is a layout decision made later and the
 * palette must not constrain it.
 */
const TEXT_TOKENS = [
  '--color-ink',
  '--color-ink-secondary',
  '--color-ink-muted',
  '--color-ui-accent',
  '--color-ui-accent-hover',
  '--color-status-verified',
  '--color-status-estimated',
  '--color-status-placeholder',
  '--color-status-conflicting',
  ...TYPES.map((t) => `--color-type-${t}`),
];

const AA = 4.5;
const NON_TEXT = 3;

/** Collects every failure and reports them together — SPEC.md §2 principle 8. */
function reportAll(failures, what) {
  assert.equal(
    failures.length,
    0,
    `${failures.length} ${what}:\n  ${failures.join('\n  ')}`,
  );
}

test('every colour token is defined in both themes', () => {
  const failures = [];
  for (const name of DARK.keys()) {
    if (!LIGHT.has(name)) failures.push(`${name} is defined in @theme (dark) but not in light`);
  }
  for (const name of LIGHT.keys()) {
    if (!DARK.has(name)) failures.push(`${name} is defined in light but not in @theme (dark)`);
  }
  reportAll(failures, 'unpaired colour tokens');
});

test('no colour token has the same value in both themes', () => {
  const failures = [];
  for (const [name, dark] of DARK) {
    const light = LIGHT.get(name);
    if (light && light.raw === dark.raw) {
      failures.push(`${name} is ${dark.raw} in both themes — it was never actually themed`);
    }
  }
  reportAll(failures, 'unthemed colour tokens');
});

test('every text token clears WCAG AA on every surface, in both themes', () => {
  const failures = [];
  for (const [theme, tokens] of Object.entries(THEMES)) {
    for (const fg of TEXT_TOKENS) {
      for (const bg of SURFACES) {
        const ratio = contrast(tokens.get(fg).oklch, tokens.get(bg).oklch);
        if (ratio < AA) {
          failures.push(`${theme}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1 (needs ${AA})`);
        }
      }
    }
  }
  reportAll(failures, 'contrast failures');
});

test('ink clears AA on every type tint, and each type accent on its own tint', () => {
  const failures = [];
  for (const [theme, tokens] of Object.entries(THEMES)) {
    for (const t of TYPES) {
      const tint = tokens.get(`--color-type-${t}-surface`).oklch;

      const inkRatio = contrast(tokens.get('--color-ink').oklch, tint);
      if (inkRatio < AA) {
        failures.push(`${theme}: --color-ink on --color-type-${t}-surface = ${inkRatio.toFixed(2)}:1`);
      }

      const accentRatio = contrast(tokens.get(`--color-type-${t}`).oklch, tint);
      if (accentRatio < AA) {
        failures.push(
          `${theme}: --color-type-${t} on its own -surface = ${accentRatio.toFixed(2)}:1`,
        );
      }
    }
  }
  reportAll(failures, 'type-accent contrast failures');
});

test('line-strong is perceivable (3:1) against every surface', () => {
  const failures = [];
  for (const [theme, tokens] of Object.entries(THEMES)) {
    for (const bg of SURFACES) {
      const ratio = contrast(tokens.get('--color-line-strong').oklch, tokens.get(bg).oklch);
      if (ratio < NON_TEXT) {
        failures.push(`${theme}: --color-line-strong on ${bg} = ${ratio.toFixed(2)}:1 (needs ${NON_TEXT})`);
      }
    }
  }
  reportAll(failures, 'border contrast failures');
});

test('the UI accent is not a content accent in disguise', () => {
  // SPEC.md §11 keeps the two colour systems separate; if the UI accent drifts
  // into a type accent's hue the reader loses the one colour that always means
  // "this is interactive".
  const failures = [];
  for (const [theme, tokens] of Object.entries(THEMES)) {
    const ui = tokens.get('--color-ui-accent').oklch;
    for (const t of TYPES) {
      const accent = tokens.get(`--color-type-${t}`).oklch;
      if (accent.C < 0.03) continue; // `platform` is neutral by design
      const dh = Math.abs(((ui.h - accent.h + 540) % 360) - 180);
      if (dh < 30) {
        failures.push(`${theme}: --color-ui-accent (h ${ui.h}) is ${dh.toFixed(0)}° from --color-type-${t}`);
      }
    }
  }
  reportAll(failures, 'accent-system collisions');
});
