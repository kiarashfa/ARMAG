/**
 * Reducing MDX prose to the words a reader would actually see.
 *
 * One definition, two callers that must agree: the near-duplicate gate
 * (`integrity-checks.ts`, SPEC.md §13 gate 4) and the completeness score
 * (`catalogue.ts`, SPEC.md §5.9). If they counted differently, an entry could
 * clear the 60-word publication floor while the duplicate gate saw too few
 * words to compare — and nobody would ever notice, because both would be
 * "working".
 *
 * Import statements, JSX components, code fences, link targets and formatting
 * marks are all stripped: two entries that share a component import do not
 * share prose, and counting the markup would both mask real duplication and
 * invent fake duplication between short entries.
 *
 * Pure. No DOM, no I/O.
 */

export function proseWords(body: string): string[] {
  return body
    .replace(/^import\s+.*$/gm, ' ')
    .replace(/^export\s+.*$/gm, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>|~-]+/g, ' ')
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length > 0);
}

export const proseWordCount = (body: string): number => proseWords(body).length;

/** Overlapping k-word windows — the unit the duplicate gate compares. */
export function shingles(words: string[], size: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + size <= words.length; i += 1) {
    set.add(words.slice(i, i + size).join(' '));
  }
  return set;
}

/** Jaccard similarity of two shingle sets: shared over union. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) if (large.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}
