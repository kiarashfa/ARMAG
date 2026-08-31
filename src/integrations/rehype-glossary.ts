/**
 * Automatic glossary linking — SPEC.md §5.6.
 *
 * "Every glossary term is auto-crosslinked from every occurrence in any prose
 * on the site." A reader meeting "delayed blowback" in the middle of a
 * paragraph about the MP5 gets the definition one click away, and no author
 * ever writes that link.
 *
 * ── Why this is a second plugin and not more entries in the first ──────────
 * The matching rule is genuinely different. Entry names are proper nouns and
 * are matched **case-sensitively**, because "luger" in running text is far more
 * often the cartridge designation than the pistol. Glossary terms are common
 * nouns — "bullpup", "headspace", "open bolt" — and appear at the start of a
 * sentence as often as inside one, so they are matched **case-insensitively**
 * and the anchor keeps the author's own casing.
 *
 * The tree walker itself is shared with `rehype-crosslink.ts`: one walker, two
 * vocabularies. Two walkers would be two places for the skip-tag list to rot.
 *
 * Ordering matters and is set in `astro.config.ts`: entries run first. An
 * entry name is more specific than a glossary term, and once an entry link
 * exists the glossary pass cannot reach inside it — `a` is a skip tag.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  entryIdFromPath,
  linkTree,
  resolveTargets,
  urlFor,
  type HastNode,
  type LinkTarget,
  type VFileLike,
} from './rehype-crosslink.ts';

/**
 * The frontmatter fields this plugin needs, read directly from the `.mdx`.
 *
 * A deliberately narrow reader rather than a YAML dependency: it needs three
 * scalar fields and one flat list from a file whose schema is already enforced
 * by Astro's content collection. Anything it cannot parse it skips, and the
 * consequence of skipping is a missing link, never a wrong one.
 */
export function readGlossaryFrontmatter(
  source: string,
): { id?: string; term?: string; short?: string; aka: string[] } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) return null;

  const out: { id?: string; term?: string; short?: string; aka: string[] } = { aka: [] };
  const unquote = (value: string): string => value.trim().replace(/^["']|["']$/g, '');

  let inAka = false;
  for (const line of match[1]!.split(/\r?\n/)) {
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (inAka && listItem) {
      const value = unquote(listItem[1]!);
      if (value) out.aka.push(value);
      continue;
    }
    inAka = false;

    const field = /^([a-zA-Z]+):\s*(.*)$/.exec(line);
    if (!field) continue;
    const [, key, raw] = field;
    if (key === 'aka' && raw!.trim() === '') {
      inAka = true;
      continue;
    }
    if (key === 'id' || key === 'term' || key === 'short') out[key] = unquote(raw!);
  }

  return out;
}

/**
 * Every glossary term and its `aka` spellings.
 *
 * `short` becomes the anchor's `title`, which is what the glossary schema's own
 * comment says that field is for: the definition on hover, without a click and
 * without a component.
 */
export function buildGlossaryTargets(contentRoot: string, base: string): LinkTarget[] {
  const dir = path.join(contentRoot, 'glossary');
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }

  const targets: LinkTarget[] = [];
  for (const file of files) {
    if (!file.endsWith('.mdx')) continue;
    let frontmatter: ReturnType<typeof readGlossaryFrontmatter>;
    try {
      frontmatter = readGlossaryFrontmatter(readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    const id = frontmatter?.id ?? file.replace(/\.mdx$/, '');
    if (!frontmatter?.term) continue;

    const url = urlFor(base, 'glossary', id);
    for (const name of [frontmatter.term, ...frontmatter.aka]) {
      targets.push({ id, name, url, title: frontmatter.short, kind: 'glossary' });
    }
  }

  return resolveTargets(targets);
}

export interface GlossaryOptions {
  /** Absolute path to `src/content`. */
  contentRoot: string;
  /** Astro's `base`. */
  base: string;
}

export default function rehypeGlossary(options: GlossaryOptions) {
  const targets = buildGlossaryTargets(options.contentRoot, options.base);

  return function transformer(tree: HastNode, file: VFileLike): void {
    linkTree(tree, targets, entryIdFromPath(file.path ?? file.history?.[0]), {
      caseInsensitive: true,
    });
  };
}
