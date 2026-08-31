/**
 * JSON-LD — SPEC.md §12.
 *
 * `Article`/`TechArticle` plus `BreadcrumbList` on content pages, `ItemList` on
 * catalogue and taxonomy views, `DefinedTerm` on glossary entries.
 *
 * ── The rule this module exists to keep ────────────────────────────────────
 * **No `Product`, no `Offer`, no `price`, no `availability`.** These are
 * encyclopedia entries, not listings. Marking a firearm up as a product with an
 * offer is a factual claim that ARMAG sells or brokers it, and it is the one
 * piece of structured data on this site that could plausibly be read that way
 * by a machine that never sees the page.
 *
 * It is enforced **twice**, deliberately, the same way gates 2 and 3 are (see
 * CLAUDE.md item 56):
 *
 *   1. Here, in `serialize()`, which throws during the build at the moment the
 *      offending node is created — so the error names the template.
 *   2. In `check:site`, which parses every `<script type="application/ld+json">`
 *      block in `dist/` and fails on the same keys — so a node built anywhere
 *      else, by anything else, is caught too.
 *
 * A rule assertable only as "some build error happened" stops catching what it
 * was written for; a rule asserted only against the artefact fires too late to
 * say which file did it. Both is cheap.
 *
 * Pure: builds plain objects and strings, reads nothing, imports nothing.
 */

/** A JSON-LD node. Deliberately loose — the shape varies by `@type`. */
export type JsonLdNode = Record<string, unknown>;

/**
 * `@type` values that describe a thing for sale.
 *
 * `AggregateOffer` and `PriceSpecification` are in the list even though nothing
 * would plausibly reach for them, because the cost of listing them is one line
 * and the cost of missing one is the claim itself.
 */
export const FORBIDDEN_TYPES = ['Product', 'Offer', 'AggregateOffer', 'PriceSpecification'] as const;

/** Property names that describe a price or a purchase. */
export const FORBIDDEN_KEYS = [
  'offers',
  'price',
  'priceCurrency',
  'priceSpecification',
  'availability',
  'itemOffered',
  'seller',
] as const;

/**
 * Every `@type` and key in a node tree, so the ban can be checked in one walk.
 *
 * Exported because `check:site` runs the same walk over the built HTML and must
 * not re-implement it — two implementations of one rule is two rules, and the
 * second one rots quietly.
 */
export function commerceViolations(node: unknown, path = '$'): string[] {
  const found: string[] = [];

  const visit = (value: unknown, at: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, `${at}[${i}]`));
      return;
    }
    if (value === null || typeof value !== 'object') return;

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((FORBIDDEN_KEYS as readonly string[]).includes(key)) {
        found.push(`${at}.${key} — a price or purchase property`);
      }
      if (key === '@type') {
        const types = Array.isArray(child) ? child : [child];
        for (const type of types) {
          if (typeof type === 'string' && (FORBIDDEN_TYPES as readonly string[]).includes(type)) {
            found.push(`${at}.@type = "${type}"`);
          }
        }
      }
      visit(child, `${at}.${key}`);
    }
  };

  visit(node, path);
  return found;
}

/**
 * JSON, safe to place inside a `<script>` element, with the commerce ban
 * enforced first.
 *
 * `<` is escaped because a caption or an entry name containing the literal
 * text `</script>` would otherwise end the element early and dump the rest of
 * the payload into the document as markup. Nothing else in the JSON needs
 * escaping: `&` and `>` are inert inside a script element, and ` ` is
 * valid in JSON strings and in JavaScript strings since ES2019.
 */
export function serialize(node: JsonLdNode | JsonLdNode[]): string {
  const violations = commerceViolations(node);
  if (violations.length > 0) {
    throw new Error(
      `JSON-LD carries commerce markup, which SPEC.md §12 forbids outright:\n  ${violations.join(
        '\n  ',
      )}\nARMAG entries are encyclopedia articles, not listings.`,
    );
  }
  return JSON.stringify(node).replace(/</g, '\\u003c');
}

// ---------------------------------------------------------------------------
// The nodes
// ---------------------------------------------------------------------------

const CONTEXT = 'https://schema.org';

/** Drops keys whose value is absent, so no node carries `"author": null`. */
function compact(node: Record<string, unknown>): JsonLdNode {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    out[key] = value;
  }
  return out;
}

export interface CrumbLike {
  label: string;
  /** Absent for the current page. */
  path?: string;
}

/**
 * `BreadcrumbList` — built from the same array the visible trail renders from,
 * so the markup and the structured data cannot describe different paths.
 *
 * The last crumb has no `item`: it is the current page, which is not a link to
 * itself, and schema.org treats a trailing `name`-only element as exactly that.
 */
export function breadcrumbList(crumbs: CrumbLike[], absolute: (path: string) => string): JsonLdNode {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) =>
      compact({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.label,
        item: crumb.path ? absolute(crumb.path) : undefined,
      }),
    ),
  };
}

export interface EntryArticleInput {
  /** `TechArticle` for a spec entry, `Article` for editorial. */
  type: 'TechArticle' | 'Article';
  name: string;
  description: string;
  /** Absolute canonical URL. */
  url: string;
  /** Absolute image URLs. */
  images?: string[];
  /** ISO date the entry's figures were last checked against their sources. */
  dateModified?: string;
  datePublished?: string;
  /** Free-text subject terms — the entry's taxonomy, not a keyword stuffing. */
  about?: string[];
  /** Where the figures came from, as plain citation strings. */
  citation?: string[];
}

/**
 * `TechArticle`/`Article`.
 *
 * `author` and `publisher` are ARMAG itself. `citation` carries the entry's own
 * bibliography, which is the one piece of structured data here that is
 * genuinely unusual and genuinely true: these pages are sourced, and saying so
 * in machine-readable form costs nothing.
 */
export function entryArticle(input: EntryArticleInput): JsonLdNode {
  return compact({
    '@context': CONTEXT,
    '@type': input.type,
    headline: input.name,
    name: input.name,
    description: input.description,
    url: input.url,
    mainEntityOfPage: input.url,
    image: input.images,
    dateModified: input.dateModified,
    datePublished: input.datePublished,
    about: input.about,
    citation: input.citation,
    isAccessibleForFree: true,
    author: { '@type': 'Organization', name: 'ARMAG' },
    publisher: { '@type': 'Organization', name: 'ARMAG' },
  });
}

export interface ItemListEntry {
  name: string;
  /** Absolute URL. Absent for an entry that has no page of its own. */
  url?: string;
}

/**
 * `ItemList` for a browse view — the catalogue, a taxonomy term, a maker's
 * model list.
 *
 * An entry below the publication floor (SPEC.md §5.9) has no page, so it is
 * listed by name with no `url` rather than pointed at a 404.
 */
export function itemList(name: string, entries: ItemListEntry[]): JsonLdNode {
  return compact({
    '@context': CONTEXT,
    '@type': 'ItemList',
    name,
    numberOfItems: entries.length,
    itemListOrder: 'https://schema.org/ItemListUnordered',
    itemListElement: entries.map((entry, index) =>
      compact({
        '@type': 'ListItem',
        position: index + 1,
        name: entry.name,
        url: entry.url,
      }),
    ),
  });
}

export interface DefinedTermInput {
  term: string;
  description: string;
  url: string;
  /** Other names the same term goes by. */
  aka?: string[];
  /** Absolute URL of `/glossary/`. */
  setUrl: string;
}

/** `DefinedTerm` — SPEC.md §12, one per glossary entry. */
export function definedTerm(input: DefinedTermInput): JsonLdNode {
  return compact({
    '@context': CONTEXT,
    '@type': 'DefinedTerm',
    name: input.term,
    alternateName: input.aka,
    description: input.description,
    url: input.url,
    inDefinedTermSet: {
      '@type': 'DefinedTermSet',
      name: 'ARMAG glossary',
      url: input.setUrl,
    },
  });
}
