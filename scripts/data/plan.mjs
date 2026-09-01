#!/usr/bin/env node
/**
 * The coverage plan — what gets written next, and in what order.
 *
 *   node scripts/data/plan.mjs build            # rebuild plan/coverage.json
 *   node scripts/data/plan.mjs build --categories
 *   node scripts/data/plan.mjs status
 *   node scripts/data/plan.mjs next 8
 *   node scripts/data/plan.mjs next 8 --kind cartridge --list "List of shotguns"
 *
 * CLAUDE.md item 20: **assignment must be systematic, not orchestrator taste.**
 * The order below is derived from the sources and is reproducible; nobody picks
 * the next batch.
 *
 * Where the candidates come from, and why not from Wikidata: SPEC.md Appendix A
 * records the 2026-08-26 SPARQL result — `firearm model` holds ~668 items and
 * the `firearm` subclass tree ~402, dominated by museum artefacts. English
 * Wikipedia's list articles hold thousands. Wikidata stays the join key.
 *
 * **What makes a candidate an arm is not the list it was found on.** A list
 * article links to countries, calibres, designers and other lists as well as to
 * arms. Every candidate is classified by whether its own article transcludes
 * `{{Infobox weapon}}` or `{{Infobox firearm cartridge}}` — the definitive test,
 * and cheap: `prop=templates&tltemplates=…` answers it 50 titles at a time.
 *
 * **Scope is not decided here.** `{{Infobox weapon}}` also covers swords,
 * missiles and tanks, and deciding that a 20 mm autocannon is out (SPEC.md §15,
 * CLAUDE.md item 16) is a judgement about the arm, not about its infobox. The
 * plan is a candidate list; an author rejects out-of-scope entries and records
 * the rejection with `plan.mjs` untouched.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getJson, withQuery } from './lib/http.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PLAN = path.join(REPO_ROOT, 'plan', 'coverage.json');
const EN = 'https://en.wikipedia.org/w/api.php';

/** Sizes verified 2026-08-26 (CLAUDE.md, research findings). */
const LIST_ARTICLES = [
  { title: 'List of firearms', kind: 'gun' },
  { title: 'List of pistols', kind: 'gun' },
  { title: 'List of revolvers', kind: 'gun' },
  { title: 'List of rifles', kind: 'gun' },
  { title: 'List of carbines', kind: 'gun' },
  { title: 'List of assault rifles', kind: 'gun' },
  { title: 'List of sniper rifles', kind: 'gun' },
  { title: 'List of submachine guns', kind: 'gun' },
  { title: 'List of machine guns', kind: 'gun' },
  { title: 'List of shotguns', kind: 'gun' },
  { title: 'List of rifle cartridges', kind: 'cartridge' },
  { title: 'List of handgun cartridges', kind: 'cartridge' },
  { title: 'List of cartridges by caliber', kind: 'cartridge' },
];

/** Seeds for the optional category walk — arms the lists happen to have missed. */
const CATEGORY_SEEDS = [
  'Category:Firearms by type',
  'Category:Firearms by country',
  'Category:Pistol cartridges',
  'Category:Rifle cartridges',
];

const WEAPON_TEMPLATE = 'Template:Infobox weapon';
const CARTRIDGE_TEMPLATE = 'Template:Infobox firearm cartridge';

/** Every namespace-0 link on a page, following continuation. */
async function articleLinks(title) {
  const links = [];
  let cont;
  do {
    const data = await getJson(
      withQuery(EN, {
        action: 'query',
        prop: 'links',
        plnamespace: '0',
        pllimit: 'max',
        titles: title,
        redirects: '1',
        format: 'json',
        formatversion: '2',
        ...(cont ? { plcontinue: cont } : {}),
      }),
    );
    const page = data.query?.pages?.[0];
    if (page?.missing) throw new Error(`"${title}" does not exist`);
    for (const link of page?.links ?? []) links.push(link.title);
    cont = data.continue?.plcontinue;
  } while (cont);
  return links;
}

async function categoryMembers(category, type) {
  const out = [];
  let cont;
  do {
    const data = await getJson(
      withQuery(EN, {
        action: 'query',
        list: 'categorymembers',
        cmtitle: category,
        cmtype: type,
        cmlimit: '500',
        format: 'json',
        formatversion: '2',
        ...(cont ? { cmcontinue: cont } : {}),
      }),
    );
    for (const member of data.query?.categorymembers ?? []) out.push(member.title);
    cont = data.continue?.cmcontinue;
  } while (cont);
  return out;
}

/**
 * Depth-limited category walk.
 *
 * CLAUDE.md's research finding is that firearm categories are deeply nested and
 * direct membership counts are misleadingly small, so a walk is the only way to
 * see them — but the tree is also large, so it is bounded and opt-in. Every
 * visited category is recorded so a re-run covers the same ground.
 */
async function walkCategories(seeds, maxDepth, maxCategories) {
  const seen = new Set();
  const pages = new Map();
  let frontier = seeds;
  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next = [];
    for (const category of frontier) {
      if (seen.has(category) || seen.size >= maxCategories) continue;
      seen.add(category);
      for (const page of await categoryMembers(category, 'page')) {
        if (!pages.has(page)) pages.set(page, category);
      }
      if (depth < maxDepth) next.push(...(await categoryMembers(category, 'subcat')));
    }
    console.error(`  depth ${depth}: ${seen.size} categor(ies) visited, ${pages.size} page(s)`);
    frontier = next;
  }
  return pages;
}

/**
 * Classifies candidates by the infobox their own article transcludes, and picks
 * up article size and Wikidata id in the same request.
 */
async function classify(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    const data = await getJson(
      withQuery(EN, {
        action: 'query',
        prop: 'info|templates|pageprops',
        tltemplates: `${WEAPON_TEMPLATE}|${CARTRIDGE_TEMPLATE}`,
        tllimit: '500',
        ppprop: 'wikibase_item',
        titles: chunk.join('|'),
        redirects: '1',
        format: 'json',
        formatversion: '2',
      }),
    );
    // Redirects mean the answer can come back under a different title than the
    // one asked for; both are recorded so a list entry still resolves.
    const redirects = new Map((data.query?.redirects ?? []).map((r) => [r.from, r.to]));
    for (const page of data.query?.pages ?? []) {
      const templates = (page.templates ?? []).map((t) => t.title);
      const kind = templates.includes(CARTRIDGE_TEMPLATE)
        ? 'cartridge'
        : templates.includes(WEAPON_TEMPLATE)
          ? 'gun'
          : null;
      out.set(page.title, {
        title: page.title,
        kind,
        bytes: page.length ?? 0,
        wikidataId: page.pageprops?.wikibase_item ?? null,
      });
    }
    for (const [from, to] of redirects) {
      const target = out.get(to);
      if (target) out.set(from, { ...target, redirectedFrom: from });
    }
    process.stderr.write(`\r  classified ${Math.min(i + 50, titles.length)}/${titles.length}`);
  }
  process.stderr.write('\n');
  return out;
}

/** A stable slug proposal. The author owns the final one — SPEC.md §5.1. */
function proposeSlug(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[×✕]/g, 'x')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** What is already authored, so the plan never proposes it again. */
async function existingEntries() {
  const ids = new Set();
  const qids = new Set();
  const names = new Set();
  for (const dir of ['gunData', 'cartridgeData']) {
    const full = path.join(REPO_ROOT, 'src', 'content', dir);
    const files = await readdir(full).catch(() => []);
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      const data = JSON.parse(await readFile(path.join(full, file), 'utf8'));
      ids.add(data.id);
      if (data.wikidataId) qids.add(data.wikidataId);
      names.add(proposeSlug(data.name));
      for (const alias of data.aliases ?? []) names.add(proposeSlug(alias.name));
    }
  }
  return { ids, qids, names };
}

async function cmdBuild(options) {
  const sources = new Map();
  const record = (title, source) => {
    if (!sources.has(title)) sources.set(title, new Set());
    sources.get(title).add(source);
  };

  for (const list of LIST_ARTICLES) {
    const links = await articleLinks(list.title);
    for (const link of links) record(link, list.title);
    console.error(`${String(links.length).padStart(5)} link(s)  ${list.title}`);
  }

  if (options.categories) {
    console.error('\ncategory walk:');
    const pages = await walkCategories(CATEGORY_SEEDS, options.catDepth, options.maxCategories);
    for (const [page, category] of pages) record(page, category);
  }

  const titles = [...sources.keys()];
  console.error(`\n${titles.length} distinct candidate title(s); classifying by infobox…`);
  const classified = await classify(titles);

  const existing = await existingEntries();

  /*
   * Merge by the article a title resolves to, not by the title itself.
   *
   * Wikipedia redirects every Glock model to one article: `Glock 17`, `Glock
   * 19`, `Glock 26` and thirty-three others all land on `Glock`. Keyed by link
   * title, that produced thirty-six identical rows — and the same thing for 424
   * other slugs. Merged, one row carries all thirty-six names, which is more
   * useful than the deduplication: it is the list of models this one article
   * has to serve, i.e. exactly the variants-as-tabs question of SPEC.md §5.2.
   */
  const merged = new Map();
  for (const [title, from] of sources) {
    const info = classified.get(title);
    // Not an arm article. Discarded rather than recorded: a plan carrying every
    // country and designer a list links to is a plan nobody reads.
    if (!info?.kind) continue;
    const key = info.title;
    if (!merged.has(key)) {
      merged.set(key, { info, sources: new Set(), linkedAs: new Set() });
    }
    const row = merged.get(key);
    for (const source of from) row.sources.add(source);
    if (title !== info.title) row.linkedAs.add(title);
  }

  const rows = [];
  for (const { info, sources: from, linkedAs } of merged.values()) {
    const slug = proposeSlug(info.title);
    const names = [info.title, ...linkedAs];
    // An article already backing an authored entry under one of its redirect
    // names is reported, not hidden: `Glock` backs `glock-17`, and `Glock 19`
    // redirects to the same article without being authored.
    const authoredAs = names.map(proposeSlug).filter((n) => existing.ids.has(n) || existing.names.has(n));
    rows.push({
      title: info.title,
      slug,
      kind: info.kind,
      wikidataId: info.wikidataId,
      bytes: info.bytes,
      sources: [...from].sort(),
      linkedAs: [...linkedAs].sort(),
      authoredAs: [...new Set(authoredAs)],
      done:
        existing.ids.has(slug) ||
        (info.wikidataId !== null && existing.qids.has(info.wikidataId)) ||
        existing.names.has(slug),
    });
  }

  /*
   * The order, and it is the whole point of the file:
   *
   *  1. how many sources found it — an arm on six lists is more central than
   *     one on a single specialist list, and that is a property of the sources
   *     rather than of anyone's interest;
   *  2. article size — a proxy for how much sourced material exists, which is
   *     what actually determines whether an entry can clear the publication
   *     floor (SPEC.md §5.9) rather than sit as a thin catalogue row;
   *  3. title, so the order is stable across rebuilds.
   */
  rows.sort(
    (a, b) =>
      b.sources.length - a.sources.length || b.bytes - a.bytes || a.title.localeCompare(b.title),
  );
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  await mkdir(path.dirname(PLAN), { recursive: true });
  await writeFile(
    PLAN,
    `${JSON.stringify(
      {
        note: 'Coverage plan. Rebuild with `plan.mjs build`; take work with `plan.mjs next N`. Gitignored — it is derived, and regenerating it is one command. Rank is deterministic: source count, then article size, then title.',
        built: new Date().toISOString().slice(0, 10),
        lists: LIST_ARTICLES.map((l) => l.title),
        categoryWalk: options.categories
          ? { seeds: CATEGORY_SEEDS, depth: options.catDepth }
          : null,
        counts: {
          candidates: rows.length,
          guns: rows.filter((r) => r.kind === 'gun').length,
          cartridges: rows.filter((r) => r.kind === 'cartridge').length,
          done: rows.filter((r) => r.done).length,
        },
        rows,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.error(
    `\nwrote ${path.relative(REPO_ROOT, PLAN)} — ${rows.length} candidate(s), ` +
      `${rows.filter((r) => r.kind === 'gun').length} gun(s), ` +
      `${rows.filter((r) => r.kind === 'cartridge').length} cartridge(s), ` +
      `${rows.filter((r) => r.done).length} already authored.`,
  );
  console.error(
    `${titles.length - rows.length} title(s) were linked from a list but carry no arms infobox — ` +
      'countries, designers, calibre articles and other lists. Discarded, not hidden.',
  );
}

const readPlan = async () => {
  const raw = await readFile(PLAN, 'utf8').catch(() => null);
  if (!raw) throw new Error('no plan yet — run `node scripts/data/plan.mjs build` first');
  return JSON.parse(raw);
};

/**
 * Re-derives `done` against the content as it is NOW.
 *
 * `build` bakes a `done` flag, and `build` refetches thirteen Wikipedia lists —
 * so between one build and the next, every entry authored in the meantime is
 * still listed as work to do. Phase 10 authored 46 guns against a plan whose
 * snapshot said 12, and `next 3` duly proposed three entries that already
 * existed. The freshness this needs costs one pass over local JSON, so it is
 * done on every read rather than trusted from the file.
 */
async function withCurrentProgress(plan) {
  const existing = await existingEntries();
  const rows = plan.rows.map((row) => {
    const names = [row.slug, ...row.linkedAs.map(proposeSlug)];
    const authoredAs = names.filter((n) => existing.ids.has(n) || existing.names.has(n));
    return {
      ...row,
      authoredAs: [...new Set(authoredAs)],
      done:
        existing.ids.has(row.slug) ||
        (row.wikidataId !== null && existing.qids.has(row.wikidataId)) ||
        existing.names.has(row.slug),
    };
  });
  return { ...plan, rows, counts: { ...plan.counts, done: rows.filter((r) => r.done).length } };
}

async function cmdStatus() {
  const plan = await withCurrentProgress(await readPlan());
  const remaining = plan.rows.filter((r) => !r.done);
  console.log(`plan built ${plan.built}`);
  console.log(`  candidates : ${plan.counts.candidates}`);
  console.log(`  guns       : ${plan.counts.guns}`);
  console.log(`  cartridges : ${plan.counts.cartridges}`);
  console.log(`  authored   : ${plan.counts.done}`);
  console.log(`  remaining  : ${remaining.length}\n`);
  const byList = new Map();
  for (const row of remaining) {
    for (const source of row.sources) byList.set(source, (byList.get(source) ?? 0) + 1);
  }
  console.log('remaining by source:');
  for (const [source, count] of [...byList].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${source}`);
  }
}

async function cmdNext(count, filters) {
  const plan = await withCurrentProgress(await readPlan());
  const rows = plan.rows
    .filter((row) => !row.done)
    .filter((row) => !filters.kind || row.kind === filters.kind)
    .filter((row) => !filters.list || row.sources.includes(filters.list))
    .slice(0, count);

  if (rows.length === 0) {
    console.log('nothing left matching that filter.');
    return;
  }
  console.log(`next ${rows.length} (rank order — do not reorder by preference):\n`);
  for (const row of rows) {
    console.log(`${String(row.rank).padStart(5)}  ${row.kind.padEnd(9)} ${row.slug}`);
    console.log(`         article  ${row.title}  (${(row.bytes / 1024).toFixed(0)} kB)`);
    console.log(`         wikidata ${row.wikidataId ?? '(none — leave the field absent)'}`);
    console.log(`         found on ${row.sources.join(', ')}`);
    if (row.linkedAs.length) {
      console.log(`         also linked as ${row.linkedAs.slice(0, 8).join(', ')}${row.linkedAs.length > 8 ? `, +${row.linkedAs.length - 8} more` : ''}`);
      console.log('         → one article, several models. Decide tabs vs promotion (SPEC.md §5.2).');
    }
    if (row.authoredAs.length) {
      console.log(`         ⚠ this article already backs ${row.authoredAs.join(', ')}`);
    }
    console.log('');
  }
  console.log(
    'One unit of work = one entry. Start each with:\n' +
      '  node scripts/data/new-entry.mjs <kind> <slug> "<Article title>"',
  );
}

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

try {
  const command = argv[0];
  if (command === 'build') {
    await cmdBuild({
      categories: argv.includes('--categories'),
      catDepth: Number(flag('cat-depth', 2)),
      maxCategories: Number(flag('max-categories', 400)),
    });
  } else if (command === 'status') {
    await cmdStatus();
  } else if (command === 'next') {
    await cmdNext(Number(argv[1] ?? 8), { kind: flag('kind', null), list: flag('list', null) });
  } else {
    console.error(
      'usage: plan.mjs build [--categories] [--cat-depth 2] | status | next <N> [--kind gun|cartridge] [--list "List of shotguns"]',
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
