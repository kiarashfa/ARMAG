/**
 * Alias redirects — SPEC.md §6.
 *
 * "Aliases (`/guns/m9/`) are Astro static redirects carrying a canonical tag —
 * they capture the search term without minting a duplicate page."
 *
 * An arm is known by several names and people type the one they know. The
 * Beretta 92 is the M9, the Glock 17 was the P80, the Remington 870 is the
 * Wingmaster. Each of those is already indexed as a search alias (Phase 8), but
 * a URL somebody guesses or a link somebody writes has to land somewhere, and
 * a redirect carrying a canonical is how that happens without a second page
 * claiming to be the entry.
 *
 * ── The three rules, and each one is a rule against a wrong answer ─────────
 *
 * 1. **An alias that slugifies to an existing entry is dropped.** "AR-15" is
 *    an alias on the AR-15 family entry and also its own id; a redirect there
 *    would shadow the real page with a redirect to itself.
 * 2. **An alias two entries both claim is dropped.** Sending a reader to one
 *    of two plausible entries is worse than sending them to neither, because
 *    nothing on the page they land on tells them a choice was made.
 * 3. **Aliases never cross collections.** A gun alias mints a `/guns/` URL and
 *    nothing else, so a cartridge and an arm sharing a designation — which
 *    happens constantly — cannot collide.
 *
 * Read from the content JSON at config time rather than from Astro's content
 * collections, for the same reason the crosslink plugin is: the config is what
 * builds the collections.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** URL-safe form of a name as an author wrote it. */
export function slugifyAlias(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface AliasEntry {
  id: string;
  aliases: string[];
}

/**
 * `{ '/guns/m9/': '/guns/beretta-92/' }` for one collection.
 *
 * Separated from the file reading so the rules are testable against a fixed
 * vocabulary rather than against whatever the catalogue happens to hold today.
 */
export function redirectsFor(
  segment: string,
  entries: AliasEntry[],
  base = '',
): Record<string, string> {
  const ids = new Set(entries.map((entry) => entry.id));

  // Which entries claim each alias slug. A Set, because one entry listing the
  // same name twice is not a collision.
  const claims = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      const slug = slugifyAlias(alias);
      if (!slug || ids.has(slug)) continue; // rule 1
      const claimants = claims.get(slug) ?? new Set<string>();
      claimants.add(entry.id);
      claims.set(slug, claimants);
    }
  }

  const out: Record<string, string> = {};
  for (const [slug, claimants] of claims) {
    if (claimants.size > 1) continue; // rule 2
    // The KEY is base-relative — Astro prepends `base` to the route it builds.
    // The VALUE is not: Astro writes it into the `Location`, the meta refresh
    // and the canonical exactly as given, so a value without the base sends
    // every alias to a 404 and points the canonical at a URL that does not
    // exist. Found by reading the first redirect page this emitted.
    out[`/${segment}/${slug}/`] = `${base}/${segment}/${[...claimants][0]}/`.replace(/\/{2,}/g, '/');
  }
  return out;
}

function readEntries(dir: string): AliasEntry[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  const out: AliasEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const data = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as {
        id?: unknown;
        aliases?: { name?: unknown }[];
      };
      if (typeof data.id !== 'string') continue;
      out.push({
        id: data.id,
        aliases: (data.aliases ?? [])
          .map((alias) => alias?.name)
          .filter((value): value is string => typeof value === 'string'),
      });
    } catch {
      // A malformed content file is `check:content`'s to report, by name. A
      // throw here would replace that message with a config-load stack trace.
    }
  }
  return out;
}

/** Every alias redirect on the site, ready for `defineConfig({ redirects })`. */
export function aliasRedirects(contentRoot: string, base = ''): Record<string, string> {
  return {
    ...redirectsFor('guns', readEntries(path.join(contentRoot, 'gunData')), base),
    ...redirectsFor('cartridges', readEntries(path.join(contentRoot, 'cartridgeData')), base),
  };
}
