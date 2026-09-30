<script lang="ts">
  /**
   * The catalogue.
   *
   * **One filtered, sorted list drives both renderings.** The dense table and
   * the card grid read the same `$derived` array, so "what matches" has exactly
   * one answer on this page. Two lists would eventually disagree, and the one
   * that disagreed would be whichever the reader was looking at.
   *
   * Filter state serialises to the URL, which makes a view shareable and lets
   * editorial prose deep-link into a pre-filtered catalogue.
   *
   * Facet counts are computed against every *other* active filter rather than
   * the final result set. That is the difference between a facet list that
   * helps and one that collapses to a single option the moment you use it.
   */
  import type { CatalogueRow } from '../../lib/content/catalogue.ts';
  import FacetMenu from './FacetMenu.svelte';

  interface VocabTerm {
    id: string;
    label: string;
  }

  interface Props {
    /** Base-aware URL of the build artifact. */
    src: string;
    /** Base-aware `/guns/` prefix, so the island never builds a path itself. */
    gunPrefix: string;
    /** Labels for every axis, passed in so the island imports no vocabulary. */
    vocab: Record<AxisKey, VocabTerm[]>;
    /** Rendered server-side and shown until this island mounts. */
    staticCount: number;
  }

  type AxisKey = 'type' | 'action' | 'operatingSystem' | 'feed' | 'role' | 'country' | 'era';

  const { src, gunPrefix, vocab, staticCount }: Props = $props();

  const AXES: { key: AxisKey; label: string; param: string; multi: boolean }[] = [
    // In the table's order where it has a column (Type, the maker's Country,
    // the Era of introduction); the filters with no column follow. Multiple
    // choice where comparing makes sense ("pistols or revolvers"); one
    // mechanism at a time for action and operating system.
    { key: 'type', label: 'Type', param: 'type', multi: true },
    { key: 'country', label: 'Country', param: 'country', multi: true },
    { key: 'era', label: 'Era', param: 'era', multi: true },
    { key: 'action', label: 'Action', param: 'action', multi: false },
    { key: 'operatingSystem', label: 'Operating system', param: 'os', multi: false },
    { key: 'feed', label: 'Feed', param: 'feed', multi: true },
    { key: 'role', label: 'Role', param: 'role', multi: true },
  ];

  const SORTS = [
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'makerName', label: 'Maker' },
    { key: 'cartridgeName', label: 'Cartridge' },
    { key: 'year', label: 'Introduced' },
    { key: 'massKg', label: 'Mass' },
    { key: 'barrelMm', label: 'Barrel length' },
    { key: 'capacity', label: 'Capacity' },
  ] as const;

  type SortKey = (typeof SORTS)[number]['key'];

  const PAGE = 60;

  /* ── State ──────────────────────────────────────────────────────────── */

  let rows = $state<CatalogueRow[]>([]);
  let loadState = $state<'loading' | 'ready' | 'failed'>('loading');
  let query = $state('');
  let selected = $state<Record<AxisKey, string[]>>({
    type: [],
    action: [],
    operatingSystem: [],
    feed: [],
    role: [],
    country: [],
    era: [],
  });
  let sort = $state<SortKey>('name');
  let direction = $state<'asc' | 'desc'>('asc');
  let view = $state<'table' | 'cards'>('table');
  let limit = $state(PAGE);

  /**
   * The seven facets are menus in a row under the toolbar, one button each.
   *
   * They used to be a drawer of chip rows: eighty-odd chips across seven
   * labelled rows, which made the page read as busy and grew with every new
   * country or role. A menu keeps each axis to one button however many terms it
   * holds; what is actively filtering is always visible as the chip row.
   */

  /* ── URL round-trip ─────────────────────────────────────────────────── */

  function readUrl() {
    const params = new URLSearchParams(location.search);
    query = params.get('q') ?? '';
    // Everything here is read from the PARAMS, never back off `selected`:
    // `readUrl` runs inside an $effect, and an effect that reads the state it
    // also writes hangs the page hard enough that the renderer stops answering.
    for (const axis of AXES) {
      const raw = params.get(axis.param);
      selected[axis.key] = raw ? raw.split(',').filter(Boolean) : [];
    }
    const sortParam = params.get('sort');
    if (SORTS.some((s) => s.key === sortParam)) sort = sortParam as SortKey;
    const dirParam = params.get('dir');
    if (dirParam === 'asc' || dirParam === 'desc') direction = dirParam;
    const viewParam = params.get('view');
    if (viewParam === 'table' || viewParam === 'cards') view = viewParam;
    // With no view in the address, a phone opens on cards: the table's eight
    // columns only fit a phone by scrolling sideways.
    else if (window.matchMedia('(max-width: 40rem)').matches) view = 'cards';
  }

  function writeUrl() {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    for (const axis of AXES) {
      const values = selected[axis.key];
      if (values.length > 0) params.set(axis.param, values.join(','));
    }
    if (sort !== 'name') params.set('sort', sort);
    if (direction !== 'asc') params.set('dir', direction);
    if (view !== 'table') params.set('view', view);
    const search = params.toString();
    // `replaceState`, not `pushState`: tweaking a filter is not a navigation,
    // and making the back button undo each one would trap the reader.
    history.replaceState(null, '', search ? `${location.pathname}?${search}` : location.pathname);
  }

  $effect(() => {
    // Reading these registers the dependency; `writeUrl` writes only the URL,
    // never the state it read, so this cannot loop.
    query;
    selected.type;
    selected.action;
    selected.operatingSystem;
    selected.feed;
    selected.role;
    selected.country;
    selected.era;
    sort;
    direction;
    view;
    if (loadState !== 'loading') writeUrl();
  });

  $effect(() => {
    readUrl();
    fetch(src)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('not ok'))))
      .then((payload) => {
        rows = payload.rows ?? [];
        loadState = 'ready';
      })
      .catch(() => {
        loadState = 'failed';
      });
  });

  /* ── Filtering ──────────────────────────────────────────────────────── */

  const valuesOf = (row: CatalogueRow, key: AxisKey): string[] => {
    if (key === 'feed') return row.feed;
    if (key === 'role') return row.roles;
    if (key === 'country') return row.countries;
    const single = row[key];
    return single ? [single] : [];
  };

  function matchesAxis(row: CatalogueRow, key: AxisKey): boolean {
    const chosen = selected[key];
    if (chosen.length === 0) return true;
    const has = valuesOf(row, key);
    return chosen.some((value) => has.includes(value));
  }

  const matchesQuery = (row: CatalogueRow): boolean =>
    query.trim() === '' || row.search.includes(query.trim().toLowerCase());

  const filtered = $derived(
    rows.filter(
      (row) => matchesQuery(row) && AXES.every((axis) => matchesAxis(row, axis.key)),
    ),
  );

  const typeLabel = (id: string | null): string => (vocab.type ?? []).find((t) => t.id === id)?.label ?? id ?? '';
  const TEXT_SORTS = ['type', 'makerName', 'cartridgeName'];

  /** The table's columns; each header sorts by its column, a second click reverses. */
  const COLUMNS: { key: SortKey; label: string; right?: boolean }[] = [
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'makerName', label: 'Maker' },
    { key: 'cartridgeName', label: 'Cartridge' },
    { key: 'year', label: 'Introduced', right: true },
    { key: 'massKg', label: 'Mass', right: true },
    { key: 'barrelMm', label: 'Barrel', right: true },
    { key: 'capacity', label: 'Capacity', right: true },
  ];
  function sortBy(key: SortKey) {
    direction = sort === key && direction === 'asc' ? 'desc' : 'asc';
    sort = key;
    limit = PAGE;
  }

  function compare(a: CatalogueRow, b: CatalogueRow): number {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (TEXT_SORTS.includes(sort)) {
      const text = (r: CatalogueRow) => (sort === 'type' ? typeLabel(r.type) : ((r as any)[sort] ?? ''));
      const [l, r] = [text(a), text(b)];
      // An unknown maker or cartridge sorts last in both directions, like a missing figure.
      if (!l && !r) return a.name.localeCompare(b.name);
      if (!l) return 1;
      if (!r) return -1;
      return l.localeCompare(r) || a.name.localeCompare(b.name);
    }
    const left = a[sort];
    const right = b[sort];
    // A missing figure sorts last in BOTH directions. Treating it as zero would
    // put every unrecorded mass at the top of "lightest first", which reads as
    // data rather than as absence.
    if (left === null && right === null) return a.name.localeCompare(b.name);
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  }

  const sorted = $derived(
    [...filtered].sort((a, b) => {
      const result = compare(a, b);
      if (sort !== 'name' && ((a as any)[sort] == null || (a as any)[sort] === '' || (b as any)[sort] == null || (b as any)[sort] === '')) return result;
      return direction === 'asc' ? result : -result;
    }),
  );

  const windowed = $derived(sorted.slice(0, limit));

  /**
   * Facet counts, computed against every OTHER active filter.
   *
   * This is what stops the list you are choosing from collapsing to the one
   * option you already chose.
   */
  const facets = $derived(
    Object.fromEntries(
      AXES.map((axis) => {
        const base = rows.filter(
          (row) =>
            matchesQuery(row) &&
            AXES.every((other) => other.key === axis.key || matchesAxis(row, other.key)),
        );
        const counts = new Map<string, number>();
        for (const row of base) {
          for (const value of valuesOf(row, axis.key)) {
            counts.set(value, (counts.get(value) ?? 0) + 1);
          }
        }
        const terms = (vocab[axis.key] ?? [])
          .filter((term) => counts.has(term.id) || selected[axis.key].includes(term.id))
          .map((term) => ({ ...term, count: counts.get(term.id) ?? 0 }));
        return [axis.key, terms];
      }),
    ) as Record<AxisKey, (VocabTerm & { count: number })[]>,
  );

  function toggle(key: AxisKey, id: string, multi: boolean) {
    const current = selected[key];
    if (current.includes(id)) {
      selected[key] = current.filter((value) => value !== id);
    } else {
      selected[key] = multi ? [...current, id] : [id];
    }
    limit = PAGE;
  }

  function clearAll() {
    query = '';
    for (const axis of AXES) selected[axis.key] = [];
    limit = PAGE;
  }

  const activeCount = $derived(
    AXES.reduce((total, axis) => total + selected[axis.key].length, 0) + (query ? 1 : 0),
  );

  /**
   * Every filter currently applied, flattened for the chip row.
   *
   * Read from `vocab` rather than from `facets`, because a facet list drops a
   * term whose count has fallen to zero and an applied filter must stay
   * visible and removable even when it is the reason nothing matches.
   */
  const activeFilters = $derived(
    AXES.flatMap((axis) =>
      selected[axis.key].map((id) => ({
        axis: axis.key,
        id,
        multi: axis.multi,
        label: (vocab[axis.key] ?? []).find((term) => term.id === id)?.label ?? id,
      })),
    ),
  );

  const fmt = (value: number | null, digits = 0, suffix = '') =>
    value === null ? '—' : `${value.toFixed(digits)}${suffix}`;

  /* Hides the server-rendered rows once this island is live. */
  $effect(() => {
    document.documentElement.setAttribute('data-catalogue-hydrated', '');
    return () => document.documentElement.removeAttribute('data-catalogue-hydrated');
  });
</script>

<div class="mt-6">
  <!--
    ── The console ─────────────────────────────────────────────────────────
    A header line saying what is shown and what is filtering it, each chip
    removing its own filter, so undoing one is one click and does not require
    finding it again among eighty. Then one row of search, sort, direction and
    view, and the facet menus on the next, each carrying its own count, so no
    state is ever hidden.
  -->
  <section
    aria-label="Filter the catalogue"
    class="relative z-20 rounded-lg border border-line border-t-[3px] border-t-ui-accent bg-surface-0 shadow-[0_18px_40px_-30px_rgb(0_0_0/0.5)]"
  >
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-t-[5px] border-b border-line bg-surface-1 px-4 py-2.5">
      <span class="type-title text-[17px] text-ink">Filter</span>
      <p class="type-data flex flex-wrap items-center gap-3 text-sm text-ink-secondary" aria-live="polite">
        {#if loadState === 'loading'}
          Loading the catalogue…
        {:else if loadState === 'failed'}
          <span class="text-status-conflicting">
            The catalogue could not be loaded. The {staticCount} entries below are the server-rendered
            list.
          </span>
        {:else}
          <span>
            {sorted.length}
            {sorted.length === 1 ? 'entry' : 'entries'}{rows.length !== sorted.length
              ? ` of ${rows.length}`
              : ''}
          </span>
        {/if}
      </p>
      {#if activeFilters.length > 0}
        <div class="flex flex-wrap items-center gap-2 sm:ml-auto">
          {#each activeFilters as filter (filter.axis + filter.id)}
            <button
              type="button"
              onclick={() => toggle(filter.axis, filter.id, filter.multi)}
              class="type-data flex items-center gap-1.5 rounded-full border border-line-strong bg-surface-2 px-2.5 py-0.5 text-xs text-ink"
              aria-label={`Remove filter: ${filter.label}`}
            >
              {filter.label}
              <span aria-hidden="true" class="text-ink-muted">×</span>
            </button>
          {/each}
          <button type="button" onclick={clearAll} class="type-data text-xs text-ui-accent">
            Clear all
          </button>
        </div>
      {/if}
    </div>

    <div class="flex flex-col gap-2 p-4">
      <div class="relative z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap">
        <label class="col-span-2 min-w-0 sm:min-w-56 sm:flex-1">
          <span class="sr-only">Filter by name or alias</span>
          <input
            type="search"
            bind:value={query}
            oninput={() => (limit = PAGE)}
            placeholder="Search names and aliases…"
            class="type-data h-10 w-full rounded border border-line-strong bg-surface-1 px-3 text-sm text-ink"
          />
        </label>

        <label class="shrink-0">
          <span class="sr-only">Sort by</span>
          <select
            bind:value={sort}
            class="type-data h-10 w-full rounded border border-line-strong bg-surface-1 px-3 text-sm text-ink"
          >
            {#each SORTS as option (option.key)}
              <option value={option.key}>Sort: {option.label}</option>
            {/each}
          </select>
        </label>

        <!-- Field and direction are separate controls. -->
        <button
          type="button"
          onclick={() => (direction = direction === 'asc' ? 'desc' : 'asc')}
          class="type-data h-10 shrink-0 rounded border border-line-strong bg-surface-1 px-4 text-sm text-ink"
          aria-label={`Sort direction: ${direction === 'asc' ? 'ascending' : 'descending'}`}
        >
          {direction === 'asc' ? '↑' : '↓'}
        </button>

        <div class="col-span-2 flex h-10 shrink-0 overflow-hidden rounded border border-line-strong sm:col-span-1">
          {#each ['table', 'cards'] as const as option (option)}
            <button
              type="button"
              onclick={() => (view = option)}
              aria-pressed={view === option}
              class={`type-data flex-1 px-3 text-sm ${
                view === option ? 'bg-surface-2 text-ink' : 'bg-surface-1 text-ink-secondary'
              }`}
            >
              {option === 'table' ? 'Table' : 'Cards'}
            </button>
          {/each}
        </div>
      </div>

      <!-- ── The facet menus ─────────────────────────────────────────────── -->
      <div class="relative z-10 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center max-sm:[&>*:last-child:nth-child(odd)]:col-span-2">
        {#each AXES as axis (axis.key)}
          {#if facets[axis.key].length > 1 || selected[axis.key].length > 0}
            <FacetMenu
              fill
              label={axis.label}
              terms={facets[axis.key]}
              selected={selected[axis.key]}
              multi={axis.multi}
              onchange={(next) => {
                selected[axis.key] = next;
                limit = PAGE;
              }}
            />
          {/if}
        {/each}
      </div>
    </div>
  </section>

  {#if loadState === 'ready'}
    {#if sorted.length === 0}
      <p class="type-data mt-6 rounded-lg border border-dashed border-line-strong bg-surface-1 p-6 text-sm text-ink-muted">
        Nothing matches those filters. That is a real answer about the database, not an error.
        Clear one and try again.
      </p>
    {:else if view === 'table'}
      <div class="mt-6 overflow-x-auto">
        <table class="type-data w-full min-w-[52rem] text-sm">
          <thead>
            <tr class="border-b border-line-strong text-left text-ink-muted">
              {#each COLUMNS as c (c.key)}
                <th
                  scope="col"
                  class={`p-2 ${c.right ? 'whitespace-nowrap text-right' : ''}`}
                  aria-sort={sort === c.key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    class={`inline-flex items-center gap-1 hover:text-ink ${c.right ? 'flex-row-reverse' : ''} ${sort === c.key ? 'text-ink' : ''}`}
                    onclick={() => sortBy(c.key)}
                  >
                    {c.label}
                    <span aria-hidden="true" class={sort === c.key ? 'text-ui-accent' : 'opacity-35'}
                      >{sort === c.key ? (direction === 'asc' ? '↑' : '↓') : '↕'}</span
                    >
                  </button>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each windowed as row (row.id)}
              <tr class="border-b border-line">
                <th scope="row" class="p-2 text-left font-normal">
                  {#if row.hasPage}
                    <a href={`${gunPrefix}${row.id}/`} class="text-ui-accent">{row.name}</a>
                  {:else}
                    <!-- Below the publication floor: a row, but no URL that
                         promises more than the entry has. -->
                    <span class="text-ink">{row.name}</span>
                    <span class="ml-1 text-xs text-ink-muted">(no page yet)</span>
                  {/if}
                </th>
                <td class="p-2 text-ink-secondary">{typeLabel(row.type)}</td>
                <td class="p-2 text-ink-secondary">{row.makerName ?? '—'}</td>
                <td class="p-2 text-ink-secondary">{row.cartridgeName ?? '—'}</td>
                <td class="whitespace-nowrap p-2 text-right text-ink-secondary">{row.year ?? '—'}</td>
                <td class="whitespace-nowrap p-2 text-right text-ink-secondary">{fmt(row.massKg, 3, ' kg')}</td>
                <td class="whitespace-nowrap p-2 text-right text-ink-secondary">{fmt(row.barrelMm, 0, ' mm')}</td>
                <td class="whitespace-nowrap p-2 text-right text-ink-secondary">{fmt(row.capacity, 0)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <ul class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each windowed as row (row.id)}
          <li class="rounded-lg border border-line bg-surface-1 p-3">
            {#if row.hasPage}
              <a href={`${gunPrefix}${row.id}/`} class="type-data text-sm text-ui-accent">
                {row.name}
              </a>
            {:else}
              <span class="type-data text-sm text-ink">{row.name}</span>
            {/if}
            <p class="type-data mt-1 text-xs text-ink-muted">
              {[row.makerName, row.year].filter(Boolean).join(' · ') || '—'}
            </p>
            <dl class="type-data mt-2 grid grid-cols-3 gap-1 text-xs text-ink-secondary">
              <div><dt class="text-ink-muted">Mass</dt><dd>{fmt(row.massKg, 3, " kg")}</dd></div>
              <div><dt class="text-ink-muted">Barrel</dt><dd>{fmt(row.barrelMm, 0, " mm")}</dd></div>
              <div><dt class="text-ink-muted">Rounds</dt><dd>{fmt(row.capacity, 0)}</dd></div>
            </dl>
          </li>
        {/each}
      </ul>
    {/if}

    {#if sorted.length > limit}
      <div class="mt-4 flex items-center gap-3">
        <button
          type="button"
          onclick={() => (limit += PAGE)}
          class="type-data rounded border border-line-strong bg-surface-1 px-4 py-2 text-sm text-ink"
        >
          Show {Math.min(PAGE, sorted.length - limit)} more
        </button>
        <span class="type-data text-xs text-ink-muted">
          Showing {limit} of {sorted.length}
        </span>
      </div>
    {/if}
  {/if}
</div>
