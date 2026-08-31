<script lang="ts">
  /**
   * The catalogue — SPEC.md §9.1.
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
    { key: 'type', label: 'Type', param: 'type', multi: false },
    { key: 'action', label: 'Action', param: 'action', multi: false },
    { key: 'operatingSystem', label: 'Operating system', param: 'os', multi: false },
    { key: 'feed', label: 'Feed', param: 'feed', multi: true },
    { key: 'role', label: 'Role', param: 'role', multi: true },
    { key: 'country', label: 'Country', param: 'country', multi: false },
    { key: 'era', label: 'Era', param: 'era', multi: false },
  ];

  const SORTS = [
    { key: 'name', label: 'Name' },
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
   * The seven facet lists are a drawer, closed by default.
   *
   * Open, they are 80-odd chips across seven labelled rows — most of a screen
   * of controls above a catalogue nobody has looked at yet, which is what made
   * the homepage read as busy. Closed, the toolbar is one row, and what a
   * reader still sees at all times is what is currently FILTERING the list,
   * because that is the state that changes what they are looking at. A filter
   * arriving from the URL opens the drawer, so a shared link explains itself.
   */
  let filtersOpen = $state(false);

  /* ── URL round-trip ─────────────────────────────────────────────────── */

  function readUrl() {
    const params = new URLSearchParams(location.search);
    query = params.get('q') ?? '';
    // `anyFilter` is accumulated from the PARAMS, never read back off
    // `selected`. `readUrl` runs inside an $effect, and an effect that reads
    // the state it also writes hangs the page hard enough that the renderer
    // stops answering — the same defect as CLAUDE.md item 113, two call frames
    // away from the write again.
    let anyFilter = false;
    for (const axis of AXES) {
      const raw = params.get(axis.param);
      const values = raw ? raw.split(',').filter(Boolean) : [];
      selected[axis.key] = values;
      if (values.length > 0) anyFilter = true;
    }
    const sortParam = params.get('sort');
    if (SORTS.some((s) => s.key === sortParam)) sort = sortParam as SortKey;
    const dirParam = params.get('dir');
    if (dirParam === 'asc' || dirParam === 'desc') direction = dirParam;
    const viewParam = params.get('view');
    if (viewParam === 'table' || viewParam === 'cards') view = viewParam;
    // A shared link arriving pre-filtered opens the drawer, so the reader can
    // see what was applied rather than wondering why the list is short.
    if (anyFilter) filtersOpen = true;
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

  function compare(a: CatalogueRow, b: CatalogueRow): number {
    if (sort === 'name') return a.name.localeCompare(b.name);
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
      if (sort !== 'name' && (a[sort] === null || b[sort] === null)) return result;
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
    ── Toolbar ─────────────────────────────────────────────────────────────
    One row: search, sort, direction, view, and the filter drawer's handle.
    Everything that changes what the list SHOWS is here; everything that
    changes what it CONTAINS is behind the handle, with its count on the
    button so the drawer never hides state without saying so.
  -->
  <div class="flex flex-wrap items-center gap-2">
    <label class="min-w-56 flex-1">
      <span class="sr-only">Filter by name or alias</span>
      <input
        type="search"
        bind:value={query}
        oninput={() => (limit = PAGE)}
        placeholder="Search names and aliases…"
        class="type-data w-full rounded border border-line-strong bg-surface-1 px-3 py-2 text-sm text-ink"
      />
    </label>

    <button
      type="button"
      onclick={() => (filtersOpen = !filtersOpen)}
      aria-expanded={filtersOpen}
      aria-controls="catalogue-filters"
      class={`type-data flex shrink-0 items-center gap-2 rounded border px-3 py-2 text-sm ${
        activeCount > 0 || filtersOpen
          ? 'border-line-strong bg-surface-2 text-ink'
          : 'border-line-strong bg-surface-1 text-ink-secondary hover:text-ink'
      }`}
    >
      Filters
      {#if activeCount > 0}
        <span class="rounded-full bg-ui-accent px-1.5 text-xs text-surface-0">{activeCount}</span>
      {/if}
      <span aria-hidden="true" class="text-ink-muted">{filtersOpen ? '▴' : '▾'}</span>
    </button>

    <label class="shrink-0">
      <span class="sr-only">Sort by</span>
      <select
        bind:value={sort}
        class="type-data rounded border border-line-strong bg-surface-1 px-3 py-2 text-sm text-ink"
      >
        {#each SORTS as option (option.key)}
          <option value={option.key}>Sort: {option.label}</option>
        {/each}
      </select>
    </label>

    <!-- Field and direction are separate controls, per SPEC.md §9.1. -->
    <button
      type="button"
      onclick={() => (direction = direction === 'asc' ? 'desc' : 'asc')}
      class="type-data shrink-0 rounded border border-line-strong bg-surface-1 px-3 py-2 text-sm text-ink"
      aria-label={`Sort direction: ${direction === 'asc' ? 'ascending' : 'descending'}`}
    >
      {direction === 'asc' ? '↑' : '↓'}
    </button>

    <div class="flex shrink-0 overflow-hidden rounded border border-line-strong">
      {#each ['table', 'cards'] as const as option (option)}
        <button
          type="button"
          onclick={() => (view = option)}
          aria-pressed={view === option}
          class={`type-data px-3 py-2 text-sm ${
            view === option ? 'bg-surface-2 text-ink' : 'bg-surface-1 text-ink-secondary'
          }`}
        >
          {option === 'table' ? 'Table' : 'Cards'}
        </button>
      {/each}
    </div>
  </div>

  <!--
    ── Applied filters ─────────────────────────────────────────────────────
    Always visible, drawer open or shut. Each chip removes its own filter, so
    undoing one is one click and does not require finding it again among
    eighty.
  -->
  {#if activeFilters.length > 0}
    <div class="mt-3 flex flex-wrap items-center gap-2">
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

  <!-- ── The drawer ───────────────────────────────────────────────────── -->
  {#if filtersOpen}
    <div
      id="catalogue-filters"
      class="mt-3 grid gap-x-6 gap-y-4 rounded-lg border border-line bg-surface-1 p-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      {#each AXES as axis (axis.key)}
        {#if facets[axis.key].length > 0}
          <div>
            <p class="type-data text-xs uppercase tracking-widest text-ink-muted">{axis.label}</p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              {#each facets[axis.key] as term (term.id)}
                <button
                  type="button"
                  onclick={() => toggle(axis.key, term.id, axis.multi)}
                  aria-pressed={selected[axis.key].includes(term.id)}
                  class={`type-data rounded-full border px-2.5 py-0.5 text-xs ${
                    selected[axis.key].includes(term.id)
                      ? 'border-line-strong bg-surface-2 text-ink'
                      : 'border-line text-ink-secondary hover:text-ink'
                  }`}
                >
                  {term.label}
                  <span class="text-ink-muted">{term.count}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  <!-- Result count -->
  <p class="type-data mt-4 flex flex-wrap items-center gap-3 text-sm text-ink-secondary">
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

  {#if loadState === 'ready'}
    {#if sorted.length === 0}
      <p class="type-data mt-6 rounded-lg border border-dashed border-line-strong bg-surface-1 p-6 text-sm text-ink-muted">
        Nothing matches those filters. That is a real answer about the database, not an error —
        clear one and try again.
      </p>
    {:else if view === 'table'}
      <div class="mt-4 overflow-x-auto">
        <table class="type-data w-full min-w-[44rem] text-sm">
          <thead>
            <tr class="border-b border-line-strong text-left text-ink-muted">
              <th scope="col" class="p-2">Name</th>
              <th scope="col" class="p-2">Maker</th>
              <th scope="col" class="p-2">Cartridge</th>
              <th scope="col" class="p-2 text-right">Introduced</th>
              <th scope="col" class="p-2 text-right">Mass</th>
              <th scope="col" class="p-2 text-right">Barrel</th>
              <th scope="col" class="p-2 text-right">Capacity</th>
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
                         promises more than the entry has (SPEC.md §5.9). -->
                    <span class="text-ink">{row.name}</span>
                    <span class="ml-1 text-xs text-ink-muted">(no page yet)</span>
                  {/if}
                </th>
                <td class="p-2 text-ink-secondary">{row.makerName ?? '—'}</td>
                <td class="p-2 text-ink-secondary">{row.cartridgeName ?? '—'}</td>
                <td class="p-2 text-right text-ink-secondary">{row.year ?? '—'}</td>
                <td class="p-2 text-right text-ink-secondary">{fmt(row.massKg, 3, ' kg')}</td>
                <td class="p-2 text-right text-ink-secondary">{fmt(row.barrelMm, 0, ' mm')}</td>
                <td class="p-2 text-right text-ink-secondary">{fmt(row.capacity, 0)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <ul class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
              <div><dt class="text-ink-muted">Mass</dt><dd>{fmt(row.massKg, 3)}</dd></div>
              <div><dt class="text-ink-muted">Barrel</dt><dd>{fmt(row.barrelMm, 0)}</dd></div>
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
