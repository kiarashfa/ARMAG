#!/usr/bin/env node
/**
 * Manufacturer spec-sheet extraction.
 *
 *   node scripts/data/spec.mjs read "https://us.glock.com/en/products/…/g17-gen5"
 *   node scripts/data/spec.mjs pdf  "https://.../M&P15-Sport-III-spec.pdf"
 *
 * FRICTION-LOG A1: **manufacturer spec pages are half dead and half
 * JavaScript.** Of the five makers the pilot batch needed, Glock and RemArms
 * served a readable HTML table; Colt published calibre and barrel length and
 * nothing else; Ruger's whole AR-556 line 404s from every indexed URL; and
 * Smith & Wesson's page is a BigCommerce SPA whose specifications live in an
 * embedded JSON blob invisible to any markdown extractor.
 *
 * So this tries, in this order, and says which one produced the answer:
 *
 *   1. JSON-LD (`application/ld+json`) — a `Product` with `additionalProperty`
 *   2. `__NEXT_DATA__` / `window.__INITIAL_STATE__` / `__NUXT__`
 *   3. any other embedded JSON carrying spec-shaped keys
 *   4. HTML `<table>` and `<dl>` pairs
 *   5. **the linked spec-sheet PDF**, which is not a fallback but often the
 *      best of them — S&W's PDF carried eleven figures the HTML page did not
 *
 * It extracts label/value pairs and does not interpret them. Deciding that
 * "Weight" means `massEmpty` rather than `massLoaded` is a judgement about what
 * the maker measured, and a script that guesses it produces a figure that is
 * wrong in the way SPEC.md §5.8 exists to prevent.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getBuffer, getText } from './lib/http.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Labels that look like specifications, used to recognise an unfamiliar blob. */
const SPEC_WORDS =
  /(weight|mass|length|barrel|calib|caliber|calibre|capacity|width|height|twist|rifling|trigger|sight|action|finish|overall|chamber|magazine|thread|rate)/i;

const clean = (text) =>
  String(text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Every `<script type="application/ld+json">` on the page, parsed. */
function jsonLd(html) {
  const blocks = [];
  for (const [, body] of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      blocks.push(JSON.parse(body.trim()));
    } catch {
      // A malformed block is common and is not worth failing over; the other
      // strategies still run.
    }
  }
  return blocks;
}

/** Walks any object and collects `{label, value}` pairs that look like specs. */
function harvest(node, out, depth = 0) {
  if (depth > 8 || node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    for (const item of node) harvest(item, out, depth + 1);
    return out;
  }
  if (typeof node !== 'object') return out;

  // schema.org PropertyValue, and the BigCommerce / Shopify shapes that copy it.
  const name = node.name ?? node.label ?? node.key ?? node.title ?? node.attribute;
  const value = node.value ?? node.text ?? node.content;
  if (typeof name === 'string' && (typeof value === 'string' || typeof value === 'number')) {
    if (SPEC_WORDS.test(name)) out.push({ label: clean(name), value: clean(value) });
  }
  for (const [key, child] of Object.entries(node)) {
    if (typeof child === 'string' && SPEC_WORDS.test(key) && child.length < 120) {
      out.push({ label: clean(key), value: clean(child) });
    }
    harvest(child, out, depth + 1);
  }
  return out;
}

/** Framework state blobs — the ones that carry a whole product page. */
function embeddedState(html) {
  const found = [];
  const patterns = [
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    /window\.__INITIAL_STATE__\s*=\s*([\s\S]*?);\s*<\/script>/i,
    /window\.__NUXT__\s*=\s*([\s\S]*?);\s*<\/script>/i,
    /window\.__PRELOADED_STATE__\s*=\s*([\s\S]*?);\s*<\/script>/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match) continue;
    try {
      found.push(JSON.parse(match[1].trim()));
    } catch {
      // Not JSON — often a function call in the Nuxt case. Ignore it.
    }
  }
  // BigCommerce puts the specification list in a JSON blob that is not attached
  // to any framework global. S&W's page is this shape and it is why a markdown
  // extractor sees nothing at all.
  for (const [, body] of html.matchAll(/<script[^>]*>([\s\S]{200,200000}?)<\/script>/gi)) {
    const start = body.indexOf('{');
    if (start === -1 || !SPEC_WORDS.test(body)) continue;
    try {
      found.push(JSON.parse(body.slice(start, body.lastIndexOf('}') + 1)));
    } catch {
      // Expected for most inline scripts.
    }
  }
  return found;
}

/** `<table>` rows and `<dl>` pairs — the two shapes a plain spec table takes. */
function htmlPairs(html) {
  const out = [];
  for (const [, row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => clean(m[1]));
    if (cells.length === 2 && cells[0] && cells[1]) out.push({ label: cells[0], value: cells[1] });
  }
  const terms = [...html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)];
  for (const [, term, definition] of terms) {
    const label = clean(term);
    const value = clean(definition);
    if (label && value) out.push({ label, value });
  }
  return out;
}

/**
 * A spec-shaped heading followed by its value.
 *
 * The commonest modern shape, and the one that has no table in it at all:
 * Glock's current page renders each figure as a card with `<h3>Barrel
 * Length</h3>` and `<p>114 mm | 4.49 inch</p>`. Phase 8 recorded this page as
 * "a readable HTML spec table"; by Phase 9 it is a Next.js card grid, which is
 * itself the finding — **a manufacturer URL cited today is a different document
 * in a year**, and `lastVerified` is not decoration.
 *
 * Deliberately conservative: the label must look like a specification and the
 * value must contain a digit, so ordinary prose headings do not become pairs.
 */
function headingPairs(html) {
  const out = [];
  for (const match of html.matchAll(/<h[2-6][^>]*>([\s\S]{1,80}?)<\/h[2-6]>/gi)) {
    const label = clean(match[1]);
    if (!label || !SPEC_WORDS.test(label)) continue;
    const window = html.slice(match.index + match[0].length, match.index + match[0].length + 600);
    for (const candidate of window.matchAll(/<(?:p|span|div|li)[^>]*>([\s\S]{1,120}?)<\/(?:p|span|div|li)>/gi)) {
      const value = clean(candidate[1]);
      if (value && /\d/.test(value)) {
        out.push({ label, value });
        break;
      }
    }
  }
  return out;
}

/** Links on the page that look like a downloadable specification sheet. */
function specSheetLinks(html, base) {
  const links = [];
  for (const [, href, text] of html.matchAll(/<a[^>]+href=["']([^"']+\.pdf)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    links.push({ url: new URL(href, base).href, text: clean(text) });
  }
  for (const [, href] of html.matchAll(/href=["']([^"']*(?:spec|sheet|manual|data)[^"']*\.pdf)["']/gi)) {
    const url = new URL(href, base).href;
    if (!links.some((l) => l.url === url)) links.push({ url, text: '(link text not captured)' });
  }
  return links;
}

function dedupe(pairs) {
  const seen = new Set();
  return pairs.filter(({ label, value }) => {
    const key = `${label.toLowerCase()}=${value.toLowerCase()}`;
    if (seen.has(key) || !label || !value || value.length > 160) return false;
    seen.add(key);
    return true;
  });
}

function print(strategy, pairs) {
  if (pairs.length === 0) return false;
  console.log(`\n--- ${strategy} — ${pairs.length} pair(s) ---`);
  for (const { label, value } of pairs) console.log(`  ${label.padEnd(28)} ${value}`);
  return true;
}

async function cmdRead(url) {
  const html = await getText(url, { accept: 'text/html' });
  console.log(`# ${url}`);
  console.log(`  ${html.length} bytes of HTML`);

  let any = false;
  any = print('1. JSON-LD', dedupe(harvest(jsonLd(html), []))) || any;
  any = print('2/3. embedded JSON', dedupe(harvest(embeddedState(html), []))) || any;
  any = print('4. HTML tables and definition lists', dedupe(htmlPairs(html))) || any;
  any = print('4b. heading + adjacent value', dedupe(headingPairs(html))) || any;

  const sheets = specSheetLinks(html, url);
  if (sheets.length) {
    console.log(`\n--- 5. linked PDFs (${sheets.length}) ---`);
    for (const sheet of sheets.slice(0, 12)) console.log(`  ${sheet.text}\n    ${sheet.url}`);
    console.log(
      '\n  Read these. FRICTION-LOG A1: the S&W spec-sheet PDF carried eleven figures the\n' +
        '  HTML page did not.  spec.mjs pdf "<url>"',
    );
  }

  if (!any && sheets.length === 0) {
    console.log(
      '\nNothing extractable. That is a real finding, not a tool failure — a third of the\n' +
        'makers in the pilot batch publish nothing machine-readable. Fall back to a US military\n' +
        'manual (see scripts/data/sources/manuals.json) or record the gap honestly.',
    );
  }
  console.log(
    '\nNOTHING ABOVE IS INTERPRETED. "Weight" may be with or without a magazine, and only the\n' +
      'maker knows which — record what the page says in the sourceNote, not what you assume.',
  );
}

async function cmdPdf(url) {
  const bytes = await getBuffer(url);
  await mkdir(path.join(REPO_ROOT, '.cache'), { recursive: true });
  const temp = path.join(REPO_ROOT, '.cache', 'spec-sheet.pdf');
  await writeFile(temp, bytes);
  const text = await new Promise((resolve, reject) => {
    const child = spawn('python', [path.join(REPO_ROOT, 'scripts', 'data', 'lib', 'pdftext.py'), temp], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (error) => reject(new Error(`could not run python: ${error.message}`)));
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err))));
  });
  console.log(`# ${url}\n`);
  process.stdout.write(text);
  console.error(
    '\nA maker\'s PDF is a manufacturer-spec citation and its URL is clickable, so a figure from\n' +
      'it can reach `verified`. Record the PDF URL as `sourceUrl`, not the product page it was\n' +
      'linked from — the page will be redesigned; the file usually outlives it.',
  );
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'read') await cmdRead(args[0]);
  else if (command === 'pdf') await cmdPdf(args[0]);
  else {
    console.error('usage: spec.mjs read "<product page url>" | pdf "<spec sheet url>"');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
