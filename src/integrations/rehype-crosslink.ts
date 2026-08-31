/**
 * Automatic internal cross-linking — SPEC.md §12.
 *
 * Where one entry's prose names another entry, that name becomes a link. The
 * point is internal link density nobody has to maintain: an author writes "the
 * Type 56 is a licensed AK-47" and both links appear, and keep appearing
 * correctly after either entry is renamed, because the link is **derived from
 * the content files rather than typed**.
 *
 * It runs as a **rehype plugin**, so it sees the rendered tree rather than the
 * source text. That matters: a plugin working on Markdown source would happily
 * rewrite the inside of a code fence or the text of an existing link, and the
 * tree is where those are still distinguishable.
 *
 * ── The rules, and why each exists ─────────────────────────────────────────
 *
 * 1. **First mention only, per page, per target.** Linking every occurrence of
 *    "Colt" turns a paragraph into a wall of accent colour. The first mention
 *    is where a reader might not know what it refers to.
 * 2. **Never link an entry to itself.**
 * 3. **Longest name first.** "5.56×45mm NATO" must win over "5.56×45mm", or
 *    the specific entry is unreachable and the general one is wrong.
 * 4. **Word boundaries, and case-sensitive.** Entry names are proper nouns.
 *    Lowercase "luger" mid-sentence is far more likely to be the cartridge
 *    designation in running text than a reference to the pistol entry, and the
 *    glossary plugin — which *is* case-insensitive — handles common nouns.
 * 5. **Never inside a link, a heading, or code.** An anchor inside an anchor is
 *    invalid HTML; a heading full of links reads as navigation, not a title.
 * 6a. **A name with no letter in it is dropped.** The M1911's alias list carries
 *    "1911", and the first thing it linked in a real build was the year in
 *    "Switzerland's service rifle cartridge from 1911 until the 1990s" — on a
 *    cartridge page about a different country's rifle. Dates are everywhere in
 *    this prose and a bare number is never an unambiguous reference to an arm.
 *    Found by reading the output of the first build, not by a test.
 * 6. **An ambiguous name links to nothing at all.** If two entries would both
 *    claim the same string, neither gets it. A wrong link is worse than a
 *    missing one: the reader who follows it lands somewhere the sentence did
 *    not promise, and nothing on the page tells them so. This rule is the one
 *    Markey's version does not have, and ARMAG needs it because aliases are
 *    first-class here — "M4" and "Model 11" are exactly the strings two
 *    entries can plausibly share.
 *
 * ── Where the index comes from ─────────────────────────────────────────────
 * The content files, read from disk once when the plugin is constructed. It
 * cannot come from Astro's content collections: this runs *inside* the Markdown
 * pipeline that loads them, so asking the collections here would be asking a
 * question that the asking is part of answering.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export interface VFileLike {
  path?: string;
  history?: string[];
}

export interface LinkTarget {
  /** The entry's id, so a page never links to itself and each links once. */
  id: string;
  /** Exactly as it must appear in prose. */
  name: string;
  /** Base-path-safe URL. */
  url: string;
  /** Hover text. The glossary uses it for the one-line definition. */
  title?: string;
  /** Marks the anchor in the DOM, for styling and for `check:site`. */
  kind: 'entry' | 'glossary';
}

/** Nothing inside these ever becomes a link. */
const SKIP_TAGS = new Set([
  'a',
  'code',
  'pre',
  'kbd',
  'samp',
  'script',
  'style',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

/**
 * Names too short to match safely.
 *
 * A two-character name — "AK", "M4" — would match inside model codes and
 * abbreviations across the whole catalogue, and those two in particular are
 * aliases of entries whose full names are already linked. Blunt on purpose.
 */
const MIN_NAME_LENGTH = 3;

/**
 * A name must contain a letter — rule 6a. `\p{L}` and not `[a-z]`, because
 * `nativeName` is linkable and is Cyrillic, Chinese or Arabic script.
 */
const hasLetter = (name: string): boolean => /\p{L}/u.test(name);

const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && /[\p{L}\p{N}]/u.test(char);

/**
 * The first standalone occurrence of `name` in `text`, or -1.
 *
 * A plain `indexOf` with boundary checks rather than a regular expression:
 * entry names contain `.`, `(`, `)`, `+`, `×` and `-`, every one of which would
 * have to be escaped, and an escaping bug here silently links the wrong words.
 */
export function findStandalone(text: string, name: string, caseInsensitive = false): number {
  const haystack = caseInsensitive ? text.toLowerCase() : text;
  const needle = caseInsensitive ? name.toLowerCase() : name;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return -1;
    const before = at > 0 ? text[at - 1] : undefined;
    const after = at + needle.length < text.length ? text[at + needle.length] : undefined;
    // A name ending in punctuation — ".45 ACP" — already has its own boundary;
    // only alphanumeric neighbours make a false match.
    if (!isWordChar(before) && !isWordChar(after)) return at;
    from = at + 1;
  }
}

/**
 * Drops every name claimed by more than one entry — rule 6.
 *
 * Returns the surviving targets sorted longest-name-first, which is what makes
 * the most specific entry claim the text.
 */
export function resolveTargets(targets: LinkTarget[]): LinkTarget[] {
  const byName = new Map<string, LinkTarget[]>();
  for (const target of targets) {
    if (target.name.length < MIN_NAME_LENGTH || !hasLetter(target.name)) continue;
    const list = byName.get(target.name);
    if (list) list.push(target);
    else byName.set(target.name, [target]);
  }

  const out: LinkTarget[] = [];
  for (const [, claims] of byName) {
    const ids = new Set(claims.map((claim) => claim.id));
    // Two entries want the same string: neither gets it.
    if (ids.size > 1) continue;
    out.push(claims[0]!);
  }

  return out.sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
}

interface Replacement {
  nodes: HastNode[];
  linked: string[];
}

/** Splits one text node around the first match of each still-unlinked target. */
function linkText(
  text: string,
  targets: LinkTarget[],
  used: Set<string>,
  selfId: string | null,
  caseInsensitive: boolean,
): Replacement | null {
  const available = targets.filter((t) => !used.has(t.id) && t.id !== selfId);
  if (available.length === 0) return null;

  const nodes: HastNode[] = [];
  const linked: string[] = [];
  let rest = text;
  let matched = false;

  for (;;) {
    let best: { target: LinkTarget; at: number } | null = null;
    for (const target of available) {
      if (used.has(target.id) || linked.includes(target.id)) continue;
      const at = findStandalone(rest, target.name, caseInsensitive);
      if (at === -1) continue;
      // Earliest match wins; on a tie the longer name does, which the sort
      // order already guarantees because it is checked first.
      if (best === null || at < best.at) best = { target, at };
    }
    if (!best) break;

    matched = true;
    if (best.at > 0) nodes.push({ type: 'text', value: rest.slice(0, best.at) });
    // The text as the author wrote it, not as the target spells it: a
    // case-insensitive glossary match must not rewrite "Bullpup" to "bullpup"
    // at the start of a sentence.
    const surface = rest.slice(best.at, best.at + best.target.name.length);
    nodes.push({
      type: 'element',
      tagName: 'a',
      properties: {
        href: best.target.url,
        'data-crosslink': best.target.kind,
        ...(best.target.title ? { title: best.target.title } : {}),
      },
      children: [{ type: 'text', value: surface }],
    });
    linked.push(best.target.id);
    rest = rest.slice(best.at + best.target.name.length);
  }

  if (!matched) return null;
  if (rest) nodes.push({ type: 'text', value: rest });
  return { nodes, linked };
}

/**
 * Rewrites a tree in place, linking the first mention of each target.
 *
 * Separated from the plugin so the tests exercise **this** function against a
 * fixed vocabulary, rather than a re-implementation of it that could agree with
 * a bug. The glossary plugin calls it too — one walker, two vocabularies.
 *
 * `targets` must already be sorted longest-name-first; `resolveTargets` does
 * that. `used` may be shared between calls so a page that has already linked an
 * entry does not link the glossary term of the same name underneath it.
 */
export function linkTree(
  tree: HastNode,
  targets: LinkTarget[],
  selfId: string | null,
  options: { caseInsensitive?: boolean; used?: Set<string> } = {},
): Set<string> {
  const used = options.used ?? new Set<string>();
  if (targets.length === 0) return used;
  const caseInsensitive = options.caseInsensitive ?? false;

  const visit = (node: HastNode): void => {
    if (!node.children) return;
    if (node.type === 'element' && node.tagName && SKIP_TAGS.has(node.tagName)) return;

    const out: HastNode[] = [];
    for (const child of node.children) {
      if (child.type === 'text' && typeof child.value === 'string') {
        const replaced = linkText(child.value, targets, used, selfId, caseInsensitive);
        if (replaced) {
          for (const id of replaced.linked) used.add(id);
          out.push(...replaced.nodes);
          continue;
        }
        out.push(child);
        continue;
      }
      visit(child);
      out.push(child);
    }
    node.children = out;
  };

  visit(tree);
  return used;
}

// ---------------------------------------------------------------------------
// Reading the content
// ---------------------------------------------------------------------------

export function readJsonDir(dir: string): Record<string, unknown>[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as Record<string, unknown>);
    } catch {
      // A malformed content file is the integrity checks' problem to report,
      // with a message naming the file. Failing here would replace that message
      // with a stack trace from inside the Markdown pipeline.
    }
  }
  return out;
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Base-path-safe URL, built the way `href()` does but without importing it. */
export function urlFor(base: string, ...segments: string[]): string {
  return `/${[base.replace(/^\/+|\/+$/g, ''), ...segments].filter(Boolean).join('/')}/`.replace(
    /\/{2,}/g,
    '/',
  );
}

/**
 * Every linkable entry name, including aliases.
 *
 * Aliases are included because they are how people actually refer to these
 * arms — "Light Fifty", "Wingmaster", "Parabellum" — and are exactly the
 * reference a reader most wants a link from. Rule 6 handles the collisions that
 * come with them.
 */
export function buildTargets(contentRoot: string, base: string): LinkTarget[] {
  const targets: LinkTarget[] = [];
  const push = (id: string | undefined, name: string | undefined, url: string) => {
    if (!id || !name) return;
    targets.push({ id, name, url, kind: 'entry' });
  };

  const aliasNames = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .map((alias) => asString((alias as Record<string, unknown> | undefined)?.name))
          .filter((name): name is string => name !== undefined)
      : [];

  for (const [dir, segment] of [
    ['gunData', 'guns'],
    ['cartridgeData', 'cartridges'],
    ['makerData', 'makers'],
  ] as const) {
    for (const entry of readJsonDir(path.join(contentRoot, dir))) {
      const id = asString(entry.id);
      if (!id) continue;
      const url = urlFor(base, segment, id);
      push(id, asString(entry.name), url);
      push(id, asString(entry.nativeName), url);
      for (const alias of aliasNames(entry.aliases)) push(id, alias, url);
    }
  }

  return resolveTargets(targets);
}

/** The entry a source file belongs to — `guns/glock-17.mdx` → `glock-17`. */
export function entryIdFromPath(filePath: string | undefined): string | null {
  if (!filePath) return null;
  const match = /[\\/]content[\\/][^\\/]+[\\/]([^\\/]+)\.mdx?$/.exec(filePath);
  return match?.[1] ?? null;
}

export interface CrosslinkOptions {
  /** Absolute path to `src/content`. */
  contentRoot: string;
  /** Astro's `base`. */
  base: string;
}

/**
 * The rehype plugin.
 *
 * The index is read once at construction, not once per file: the content
 * directory does not change during a build, and re-reading it for every page
 * would make the cost quadratic in the size of the catalogue for no benefit.
 */
export default function rehypeCrosslink(options: CrosslinkOptions) {
  const targets = buildTargets(options.contentRoot, options.base);

  return function transformer(tree: HastNode, file: VFileLike): void {
    linkTree(tree, targets, entryIdFromPath(file.path ?? file.history?.[0]));
  };
}
