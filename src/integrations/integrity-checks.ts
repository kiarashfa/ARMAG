/**
 * Cross-file content integrity — SPEC.md §13.
 *
 * Zod validates one file at a time. Everything that spans files — narrative ↔
 * data pairing, `id` matching its filename, a `familyRef` resolving to a real
 * entry of the right `kind`, a citation key resolving into the entry's own
 * bibliography, one narrative reading like another — is checked here, and
 * **every** violation is collected before reporting, so an author sees the
 * whole list at once rather than fixing them one build at a time.
 *
 * This module deliberately imports nothing from `astro:*`. It is plain
 * Node-runnable TypeScript (Node >= 22.18 strips the types natively), which is
 * what lets the same code back three callers:
 *   - `src/integrations/integrity.ts`       → fails `astro build`
 *   - `scripts/integrity/check-content.mjs` → the standalone `check:content` gate
 *   - `scripts/integrity/check-self.mjs`    → proves these checks still bite
 *
 * ── Why some rules are enforced twice ──────────────────────────────────────
 * The hedge-language detector and the `verified`-needs-a-`sourceUrl` rule also
 * exist as Zod refinements in `schemas/primitives.ts`. That is deliberate, not
 * an oversight: the schema version fires in the editor at the exact field,
 * while the version here carries a rule id of its own so `check:self` can
 * assert that this specific gate has not rotted. A gate that can only be
 * asserted as "some schema error happened" is a gate that quietly stops
 * catching what it was built for.
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { cartridgeDataSchema, cartridgeNarrativeSchema } from '../schemas/cartridge.ts';
import { gunDataSchema, gunNarrativeSchema } from '../schemas/gun.ts';
import { makerDataSchema, makerNarrativeSchema } from '../schemas/maker.ts';
import { hedgeWordsIn } from '../schemas/primitives.ts';
import { AUTHORED_VOCABULARIES } from '../schemas/taxonomy.ts';
import { jaccard, proseWords, shingles } from '../lib/render/prose.ts';
import defaultThresholds from '../data/thresholds.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Violation {
  /** Repo-relative path of the file at fault. */
  file: string;
  /** Stable rule id — what `check:self` asserts on. */
  rule: string;
  message: string;
}

export interface ProseThresholds {
  shingleWords: number;
  maxSimilarity: number;
  minShingles: number;
}

export interface IntegrityOptions {
  /** Directory holding `guns/`, `gunData/`, `cartridges/`, … */
  contentRoot: string;
  /** Prefix used when printing file paths. */
  displayRoot?: string;
  /** Overridable so `check:self` can drive the prose gate at a fixture scale. */
  prose?: ProseThresholds;
}

interface LoadedEntry<T> {
  /** Slug taken from the filename. */
  fileSlug: string;
  file: string;
  data: T;
}

type AnyRecord = Record<string, unknown>;

const PAIRS = [
  { narrative: 'guns', data: 'gunData', label: 'gun' },
  { narrative: 'cartridges', data: 'cartridgeData', label: 'cartridge' },
  { narrative: 'makers', data: 'makerData', label: 'maker' },
] as const;

type PairLabel = (typeof PAIRS)[number]['label'];

const NARRATIVE_SCHEMAS = {
  gun: gunNarrativeSchema,
  cartridge: cartridgeNarrativeSchema,
  maker: makerNarrativeSchema,
};

const DATA_SCHEMAS = {
  gun: gunDataSchema,
  cartridge: cartridgeDataSchema,
  maker: makerDataSchema,
};

/**
 * Identity fields the two files of a pair must agree on.
 *
 * Compared only where the narrative actually declares one, because the
 * narrative frontmatter is intentionally the smaller of the two.
 */
const SHARED_IDENTITY_FIELDS = ['id', 'name', 'kind', 'makerRef', 'familyRef', 'country'] as const;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

async function listFiles(dir: string, ext: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(ext) && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

const rel = (root: string, file: string) => path.relative(root, file).split(path.sep).join('/');

/**
 * Parses the narrow slice of YAML our narrative frontmatter is allowed to use:
 * flat `key: value` pairs with scalar values.
 *
 * Deliberately strict rather than lenient — the frontmatter schemas are
 * `.strict()` and carry only identity fields, so anything this parser cannot
 * read is a content error worth reporting, not something to skip silently.
 */
function parseFrontmatter(
  raw: string,
): { ok: true; data: AnyRecord; body: string } | { ok: false; error: string } {
  const normalised = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!normalised.startsWith('---\n')) {
    return { ok: false, error: 'file must open with a `---` frontmatter block' };
  }
  const end = normalised.indexOf('\n---', 3);
  if (end === -1) {
    return { ok: false, error: 'frontmatter block is never closed with `---`' };
  }
  const block = normalised.slice(4, end + 1);
  const body = normalised.slice(end + 4);
  const data: AnyRecord = {};

  for (const [i, line] of block.split('\n').entries()) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      return {
        ok: false,
        error: `frontmatter line ${i + 1} is indented — only flat scalar keys are allowed here (spec data belongs in the .json file)`,
      };
    }
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) {
      return { ok: false, error: `frontmatter line ${i + 1} is not a \`key: value\` pair: ${line}` };
    }
    const key = match[1]!;
    const rawValue = match[2]!.trim();
    if (rawValue === '') {
      return { ok: false, error: `frontmatter key \`${key}\` has no value` };
    }
    data[key] = parseScalar(rawValue);
  }
  return { ok: true, data, body };
}

function parseScalar(value: string): unknown {
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** Every `PropertyValue`-shaped object in an entry, with the path it sits at. */
function collectPropertyValues(
  value: unknown,
  trail = '',
  found: { at: string; pv: AnyRecord }[] = [],
): { at: string; pv: AnyRecord }[] {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectPropertyValues(item, `${trail}[${i}]`, found));
    return found;
  }
  if (value && typeof value === 'object') {
    const obj = value as AnyRecord;
    if (typeof obj.status === 'string' && ('value' in obj || 'amount' in obj)) {
      found.push({ at: trail || '(root)', pv: obj });
    }
    for (const [key, child] of Object.entries(obj)) {
      collectPropertyValues(child, trail ? `${trail}.${key}` : key, found);
    }
  }
  return found;
}

/** Every object that looks like an `ImageRef`, with the path it was found at. */
function collectImages(
  value: unknown,
  trail = '',
  found: { at: string; image: AnyRecord }[] = [],
): { at: string; image: AnyRecord }[] {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectImages(item, `${trail}[${i}]`, found));
    return found;
  }
  if (value && typeof value === 'object') {
    const obj = value as AnyRecord;
    if (typeof obj.src === 'string' && 'alt' in obj) found.push({ at: trail || 'image', image: obj });
    for (const [key, child] of Object.entries(obj)) {
      collectImages(child, trail ? `${trail}.${key}` : key, found);
    }
  }
  return found;
}

interface ZodLikeIssue {
  path: (string | number | symbol)[];
  message: string;
}
interface ZodLikeResult {
  success: boolean;
  error?: { issues: ZodLikeIssue[] };
}
interface ZodLike {
  safeParse(value: unknown): ZodLikeResult;
}

function validate(schema: unknown, value: unknown, file: string, violations: Violation[]): void {
  const result = (schema as ZodLike).safeParse(value);
  if (result.success) return;
  for (const issue of result.error?.issues ?? []) {
    const at = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
    violations.push({ file, rule: 'schema/invalid', message: `${at}: ${issue.message}` });
  }
}

async function readJson(full: string, display: string, violations: Violation[]): Promise<unknown> {
  try {
    return JSON.parse(await readFile(full, 'utf8'));
  } catch (error) {
    violations.push({
      file: display,
      rule: 'json/parse-error',
      message: `not valid JSON: ${(error as Error).message}`,
    });
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// The near-duplicate prose gate — SPEC.md §13 gate 4
// ---------------------------------------------------------------------------

/*
 * The prose helpers live in `lib/render/prose.ts` because the completeness
 * score imports them too (SPEC.md §5.9). Two definitions of "a word of prose"
 * would let an entry clear the 60-word publication floor while this gate saw
 * too few words to compare, and both would look like they were working.
 */

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

export async function runIntegrityChecks(options: IntegrityOptions): Promise<Violation[]> {
  const { contentRoot } = options;
  const displayRoot = options.displayRoot ?? process.cwd();
  const prose = options.prose ?? (defaultThresholds.prose as unknown as ProseThresholds);
  const violations: Violation[] = [];

  const narratives: Record<PairLabel, LoadedEntry<AnyRecord>[]> = { gun: [], cartridge: [], maker: [] };
  const datas: Record<PairLabel, LoadedEntry<AnyRecord>[]> = { gun: [], cartridge: [], maker: [] };
  /** Narrative bodies, for the prose gate. */
  const bodies: { file: string; words: string[] }[] = [];

  // --- load and validate every collection ---------------------------------
  for (const pair of PAIRS) {
    const narrativeDir = path.join(contentRoot, pair.narrative);
    const dataDir = path.join(contentRoot, pair.data);

    const narrativeFiles = await listFiles(narrativeDir, '.mdx');
    const dataFiles = await listFiles(dataDir, '.json');

    const narrativeSlugs = new Set(narrativeFiles.map((f) => f.replace(/\.mdx$/, '')));
    const dataSlugs = new Set(dataFiles.map((f) => f.replace(/\.json$/, '')));

    // Gate 1a — pairing, both directions.
    for (const fileSlug of narrativeSlugs) {
      if (!dataSlugs.has(fileSlug)) {
        violations.push({
          file: rel(displayRoot, path.join(narrativeDir, `${fileSlug}.mdx`)),
          rule: 'pairing/missing-data',
          message: `no matching \`${pair.data}/${fileSlug}.json\` — every narrative file needs its structured-data sibling (SPEC.md §5.1)`,
        });
      }
    }
    for (const fileSlug of dataSlugs) {
      if (!narrativeSlugs.has(fileSlug)) {
        violations.push({
          file: rel(displayRoot, path.join(dataDir, `${fileSlug}.json`)),
          rule: 'pairing/missing-narrative',
          message: `no matching \`${pair.narrative}/${fileSlug}.mdx\` — every data file needs its narrative sibling (SPEC.md §5.1)`,
        });
      }
    }

    for (const name of narrativeFiles) {
      const full = path.join(narrativeDir, name);
      const display = rel(displayRoot, full);
      const fileSlug = name.replace(/\.mdx$/, '');
      const fm = parseFrontmatter(await readFile(full, 'utf8'));
      if (!fm.ok) {
        violations.push({ file: display, rule: 'frontmatter/parse-error', message: fm.error });
        continue;
      }
      validate(NARRATIVE_SCHEMAS[pair.label], fm.data, display, violations);

      // Gate 1b — the filename is the URL slug, so the id must match it.
      if (fm.data.id !== fileSlug) {
        violations.push({
          file: display,
          rule: 'id/filename-mismatch',
          message: `frontmatter id '${String(fm.data.id)}' does not match filename '${fileSlug}'`,
        });
      }
      narratives[pair.label].push({ fileSlug, file: display, data: fm.data });
      bodies.push({ file: display, words: proseWords(fm.body) });
    }

    for (const name of dataFiles) {
      const full = path.join(dataDir, name);
      const display = rel(displayRoot, full);
      const fileSlug = name.replace(/\.json$/, '');
      const parsed = await readJson(full, display, violations);
      if (parsed === undefined) continue;

      validate(DATA_SCHEMAS[pair.label], parsed, display, violations);

      const data = parsed as AnyRecord;
      if (data.id !== fileSlug) {
        violations.push({
          file: display,
          rule: 'id/filename-mismatch',
          message: `id '${String(data.id)}' does not match filename '${fileSlug}'`,
        });
      }
      datas[pair.label].push({ fileSlug, file: display, data });
    }
  }

  // --- Gate 1c — the two files of a pair must agree on identity -----------
  for (const pair of PAIRS) {
    const dataBySlug = new Map(datas[pair.label].map((d) => [d.fileSlug, d]));
    for (const narrative of narratives[pair.label]) {
      const data = dataBySlug.get(narrative.fileSlug);
      if (!data) continue;
      for (const field of SHARED_IDENTITY_FIELDS) {
        if (!(field in narrative.data)) continue;
        if (narrative.data[field] !== data.data[field]) {
          violations.push({
            file: narrative.file,
            rule: 'id/narrative-data-mismatch',
            message: `\`${field}\` is '${String(narrative.data[field])}' here but '${String(data.data[field])}' in the data file — the two files must agree on identity`,
          });
        }
      }
    }
  }

  // --- ids are unique within their collection ------------------------------
  for (const pair of PAIRS) {
    const seen = new Map<string, string>();
    for (const entry of datas[pair.label]) {
      const id = String(entry.data.id ?? entry.fileSlug);
      const previous = seen.get(id);
      if (previous) {
        violations.push({
          file: entry.file,
          rule: 'id/duplicate',
          message: `id '${id}' is already used by ${previous}`,
        });
      } else {
        seen.set(id, entry.file);
      }
    }
  }

  // --- Gate 1d — every reference resolves, to an entry of the right kind ---
  const gunsById = new Map(datas.gun.map((g) => [String(g.data.id ?? g.fileSlug), g]));
  const cartridgeIds = new Set(datas.cartridge.map((c) => String(c.data.id ?? c.fileSlug)));
  const makerIds = new Set(datas.maker.map((m) => String(m.data.id ?? m.fileSlug)));

  /** Family ids that at least one entry claims membership of. */
  const claimedFamilies = new Set<string>();

  for (const gun of datas.gun) {
    const { file, data } = gun;
    const id = String(data.id ?? gun.fileSlug);

    if (typeof data.makerRef === 'string' && !makerIds.has(data.makerRef)) {
      violations.push({
        file,
        rule: 'maker-ref/unresolved',
        message: `makerRef '${data.makerRef}' does not resolve to any maker entry`,
      });
    }

    const familyRefs: string[] = [];
    if (typeof data.familyRef === 'string') familyRefs.push(data.familyRef);
    if (Array.isArray(data.alsoInFamilies)) {
      for (const f of data.alsoInFamilies) if (typeof f === 'string') familyRefs.push(f);
    }
    for (const familyRef of familyRefs) {
      claimedFamilies.add(familyRef);
      const target = gunsById.get(familyRef);
      if (!target) {
        violations.push({
          file,
          rule: 'family-ref/unresolved',
          message: `family '${familyRef}' does not resolve to any gun entry`,
        });
      } else if (target.data.kind !== 'family') {
        violations.push({
          file,
          rule: 'family-ref/wrong-kind',
          message: `family '${familyRef}' is a '${String(target.data.kind)}', not a 'family' — a family is a soft grouping entry of its own, never another model (SPEC.md §5.1)`,
        });
      }
    }

    const lineage = (data.lineage ?? {}) as AnyRecord;
    for (const [edge, target] of Object.entries(lineage)) {
      if (typeof target !== 'string') continue;
      if (!gunsById.has(target)) {
        violations.push({
          file,
          rule: 'lineage/unresolved',
          message: `lineage.${edge} '${target}' does not resolve to any gun entry`,
        });
      }
    }

    // Walk the derivation chain, catching cycles. A loop here would hang the
    // lineage graph renderer rather than fail it, which is worse.
    for (const edge of ['derivedFrom', 'licensedProductionOf', 'cloneOf', 'successorOf'] as const) {
      const seen = new Set<string>([id]);
      let cursor = typeof lineage[edge] === 'string' ? (lineage[edge] as string) : null;
      while (cursor) {
        if (seen.has(cursor)) {
          violations.push({
            file,
            rule: 'lineage/cycle',
            message: `lineage.${edge} chain loops back on itself via '${cursor}'`,
          });
          break;
        }
        seen.add(cursor);
        const next = (gunsById.get(cursor)?.data.lineage as AnyRecord | undefined)?.[edge];
        cursor = typeof next === 'string' ? next : null;
      }
    }

    for (const { at, ref } of collectCartridgeRefs(data)) {
      if (!cartridgeIds.has(ref)) {
        violations.push({
          file,
          rule: 'cartridge-ref/unresolved',
          message: `cartridgeRef '${ref}' at \`${at}\` does not resolve to any cartridge entry — every ballistic figure on this page is computed from it (SPEC.md §5.4)`,
        });
      }
    }
  }

  // A family page whose model list is computed from `familyRef` and comes back
  // empty is a page about nothing. SPEC.md §5.1 makes the list computed; this
  // is what stops that computation returning nothing.
  for (const gun of datas.gun) {
    if (gun.data.kind !== 'family') continue;
    const id = String(gun.data.id ?? gun.fileSlug);
    if (!claimedFamilies.has(id)) {
      violations.push({
        file: gun.file,
        rule: 'family/no-members',
        message:
          'no entry names this as its family, so the computed member list is empty — either add the members or remove the family entry (SPEC.md §5.1)',
      });
    }
  }

  /*
   * A vocabulary term's `succeededBy` must name a term that still exists.
   *
   * Added in Phase 10, after pruning `countries.json` to the terms the content
   * actually used silently removed `serbia` and left Yugoslavia pointing at
   * nothing. Nothing caught it: the pointer is inside a data file rather than a
   * content entry, and the renderer would simply have produced a link to a page
   * that is not built. Historical states are first-class terms here (SPEC.md
   * §7), so the succession links between them are content, not decoration.
   */
  for (const [axis, vocabulary] of Object.entries(AUTHORED_VOCABULARIES)) {
    const termIds = new Set(vocabulary.terms.map((term) => term.id));
    for (const term of vocabulary.terms) {
      const successor = (term as { succeededBy?: string }).succeededBy;
      if (successor && !termIds.has(successor)) {
        violations.push({
          file: `src/data/taxonomy/${axis}`,
          rule: 'taxonomy/succession-unresolved',
          message: `term '${term.id}' is succeededBy '${successor}', which is not a term on this axis — pruning or renaming a term must not leave a succession pointer dangling`,
        });
      }
    }
  }

  for (const maker of datas.maker) {
    for (const field of ['parentCompany', 'predecessorOf', 'successorOf'] as const) {
      const value = maker.data[field];
      if (typeof value === 'string' && !makerIds.has(value)) {
        violations.push({
          file: maker.file,
          rule: 'maker-ref/unresolved',
          message: `${field} '${value}' does not resolve to any maker entry`,
        });
      }
    }
  }

  // --- Gates 2, 3 and citations, across every collection ------------------
  for (const pair of PAIRS) {
    for (const entry of datas[pair.label]) {
      const declared = new Map<string, number>();
      if (Array.isArray(entry.data.references)) {
        for (const ref of entry.data.references) {
          const key = (ref as AnyRecord)?.key;
          if (typeof key === 'string') declared.set(key, (declared.get(key) ?? 0) + 1);
        }
      }
      for (const [key, count] of declared) {
        if (count > 1) {
          violations.push({
            file: entry.file,
            rule: 'citation/duplicate-key',
            message: `references[] declares '${key}' ${count} times — a citation key must be unambiguous within its entry`,
          });
        }
      }

      for (const { at, pv } of collectPropertyValues(entry.data)) {
        const status = pv.status;
        const source = typeof pv.source === 'string' ? pv.source : undefined;
        const sourceNote = typeof pv.sourceNote === 'string' ? pv.sourceNote : undefined;

        if (source && !declared.has(source)) {
          violations.push({
            file: entry.file,
            rule: 'citation/unresolved',
            message: `\`${at}\` cites '${source}', which is not in this entry's references[] — SPEC.md §13 keeps bibliographies per entry so parallel authors never collide, which also means a key must resolve locally`,
          });
        }

        // Gate 2 — a citation that cannot be clicked cannot be spot-checked.
        if (status === 'verified' && typeof pv.sourceUrl !== 'string') {
          violations.push({
            file: entry.file,
            rule: 'trust/verified-without-url',
            message: `\`${at}\` is 'verified' with no \`sourceUrl\` (SPEC.md §13 gate 2)`,
          });
        }

        // Gate 3 — the assumed-but-verified detector. The highest-value check
        // on the site: in the Markey model benchmark, four of five models
        // passed content checks while inventing at least one figure, and the
        // tell was always a hedging note behind a 'verified' badge.
        if (status === 'verified') {
          const hedges = hedgeWordsIn(sourceNote);
          if (hedges.length > 0) {
            violations.push({
              file: entry.file,
              rule: 'trust/assumed-but-verified',
              message: `\`${at}\` is 'verified' but its note hedges (${hedges.join(', ')}) — that is an assumption wearing verification's badge. Use 'estimated' and say what it was estimated from (SPEC.md §13 gate 3)`,
            });
          }
        }
      }

      for (const { at, image } of collectImages(entry.data)) {
        const credit = image.credit as AnyRecord | undefined;
        if (!credit || typeof credit.licenseType !== 'string' || credit.licenseType === '') {
          violations.push({
            file: entry.file,
            rule: 'image/missing-license',
            message: `image at \`${at}\` has no \`credit.licenseType\` — every image's legal basis must be auditable, never assumed (SPEC.md §10)`,
          });
        }
      }
    }
  }

  // --- Gate 4 — the near-duplicate prose gate -----------------------------
  const comparable = bodies
    .map((b) => ({ file: b.file, set: shingles(b.words, prose.shingleWords) }))
    .filter((b) => b.set.size >= prose.minShingles);

  for (let i = 0; i < comparable.length; i += 1) {
    for (let j = i + 1; j < comparable.length; j += 1) {
      const a = comparable[i]!;
      const b = comparable[j]!;
      const score = jaccard(a.set, b.set);
      if (score >= prose.maxSimilarity) {
        const percent = (score * 100).toFixed(0);
        // Reported against BOTH files: whichever one the author opens, the
        // message names the other, because fixing this needs to see both.
        violations.push({
          file: a.file,
          rule: 'prose/near-duplicate',
          message: `${percent}% of ${prose.shingleWords}-word phrases are shared with ${b.file} — write about this arm, not about the category (SPEC.md §13 gate 4)`,
        });
        violations.push({
          file: b.file,
          rule: 'prose/near-duplicate',
          message: `${percent}% of ${prose.shingleWords}-word phrases are shared with ${a.file} — write about this arm, not about the category (SPEC.md §13 gate 4)`,
        });
      }
    }
  }

  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
}

/** Every `cartridgeRef` in an entry, including inside variant overrides. */
function collectCartridgeRefs(
  value: unknown,
  trail = '',
  found: { at: string; ref: string }[] = [],
): { at: string; ref: string }[] {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectCartridgeRefs(item, `${trail}[${i}]`, found));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as AnyRecord)) {
      const at = trail ? `${trail}.${key}` : key;
      if (key === 'cartridgeRef' && typeof child === 'string') found.push({ at, ref: child });
      else collectCartridgeRefs(child, at, found);
    }
  }
  return found;
}

/** Human-readable report — the complete list, grouped by file (SPEC.md §13). */
export function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) return 'No content-integrity violations.';
  const byFile = new Map<string, Violation[]>();
  for (const v of violations) {
    const list = byFile.get(v.file) ?? [];
    list.push(v);
    byFile.set(v.file, list);
  }
  const lines: string[] = [
    `${violations.length} content-integrity violation${violations.length === 1 ? '' : 's'} in ${byFile.size} file${byFile.size === 1 ? '' : 's'}:`,
    '',
  ];
  for (const [file, list] of byFile) {
    lines.push(`  ${file}`);
    for (const v of list) lines.push(`    [${v.rule}] ${v.message}`);
    lines.push('');
  }
  return lines.join('\n');
}
