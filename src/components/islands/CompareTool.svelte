<script lang="ts">
  /**
   * Compare — SPEC.md §9.2.
   *
   * Up to four entries, side by side, URL-shareable. **Every row comes from the
   * registry**, passed in as a prop, which is the same ordered list the gun
   * page's spec table renders — so a field added to `gun.ts` appears here with
   * no edit in this file (Instruction.md Phase 6).
   *
   * ── No winner badges, deliberately ────────────────────────────────────────
   * Nothing here marks a column as better. Lighter is better for carry and
   * worse for recoil; shorter is better in a vehicle and worse on a bench. The
   * site does not know what the reader wants, and pretending otherwise is the
   * editorial failure this project exists to avoid. The two toggles help a
   * reader *find* differences; they never rank them.
   *
   * ── Why one fetch per entry ───────────────────────────────────────────────
   * `/compare/data/<slug>.json` is one file per entry, not one file for the
   * database. At three thousand entries a single bundle would be megabytes to
   * compare two arms; four small fetches stay four small fetches forever.
   */
  import { untrack } from 'svelte';
  import { formatValue } from '../../lib/render/format.ts';
  import { ordinal } from '../../lib/math/percentile.ts';
  import type { CompareCell, CompareEntry } from '../../lib/compare/entry.ts';
  import type { CompareRow } from '../../lib/compare/rows.ts';

  interface CatalogueRowLite {
    id: string;
    name: string;
    search: string;
    makerName: string | null;
    hasPage: boolean;
  }

  interface Props {
    rows: CompareRow[];
    groups: string[];
    /** Base-aware `/compare/data/`. */
    dataPrefix: string;
    gunPrefix: string;
    comparePath: string;
    /** Base-aware `/catalogue.json`, for the entry picker. */
    catalogueSrc: string;
    limit: number;
  }

  const { rows, groups, dataPrefix, gunPrefix, comparePath, catalogueSrc, limit }: Props = $props();

  /* ── State ──────────────────────────────────────────────────────────── */

  let ids = $state<string[]>([]);
  let entries = $state<Record<string, CompareEntry>>({});
  let failed = $state<string[]>([]);
  let loading = $state(true);

  let highlight = $state(true);
  let hideIdentical = $state(false);

  let picking = $state(false);
  let query = $state('');
  let catalogue = $state<CatalogueRowLite[] | null>(null);

  const loaded = $derived(ids.map((id) => entries[id]).filter((entry): entry is CompareEntry => !!entry));

  /* ── URL round trip ─────────────────────────────────────────────────── */

  const idsInUrl = (): string[] =>
    (new URLSearchParams(location.search).get('guns') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, limit);

  function writeUrl() {
    const search = ids.length > 0 ? `?guns=${ids.join(',')}` : '';
    history.replaceState(null, '', `${location.pathname}${search}`);
  }

  async function load(id: string) {
    if (entries[id]) return;
    try {
      const response = await fetch(`${dataPrefix}${id}.json`);
      if (!response.ok) throw new Error(String(response.status));
      entries[id] = (await response.json()) as CompareEntry;
      failed = failed.filter((other) => other !== id);
    } catch {
      // A slug that does not resolve is named rather than dropped: a shared
      // link with a typo should say which entry it could not find.
      if (!failed.includes(id)) failed = [...failed, id];
    }
  }

  /*
   * `untrack`, and it is load-bearing. This effect WRITES `ids` and `entries`,
   * and `load` READS `entries` to skip one it already has — an effect that
   * reads state it also writes re-runs itself forever, which Svelte reports as
   * `effect_update_depth_exceeded` and which looks, from the page, like a tab
   * that has simply stopped answering. Reading the URL once, untracked, is the
   * whole of the mount behaviour; everything after this is driven by events.
   */
  $effect(() => {
    untrack(() => {
      const initial = idsInUrl();
      ids = initial;
      void Promise.all(initial.map(load)).finally(() => {
        loading = false;
      });
    });
  });

  function remove(id: string) {
    ids = ids.filter((other) => other !== id);
    writeUrl();
  }

  function add(id: string) {
    if (ids.includes(id) || ids.length >= limit) return;
    ids = [...ids, id];
    writeUrl();
    void load(id);
    query = '';
  }

  async function openPicker() {
    picking = !picking;
    if (!picking || catalogue) return;
    try {
      const response = await fetch(catalogueSrc);
      const payload = (await response.json()) as { rows: CatalogueRowLite[] };
      catalogue = payload.rows ?? [];
    } catch {
      catalogue = [];
    }
  }

  const suggestions = $derived.by(() => {
    if (!catalogue || query.trim() === '') return [];
    const needle = query.trim().toLowerCase();
    return catalogue
      .filter((row) => row.search.includes(needle) && !ids.includes(row.id))
      .slice(0, 8);
  });

  /* ── Row comparison ─────────────────────────────────────────────────── */

  /** A cell reduced to something comparable. Never shown; only compared. */
  function signature(cell: CompareCell | undefined): string {
    if (!cell) return '∅';
    switch (cell.kind) {
      case 'scalar':
        return `${cell.value}`;
      case 'derived':
        return `${cell.derived.value}`;
      case 'enum':
        return cell.term ?? '∅';
      case 'list':
        return [...cell.terms.map((term) => term.id)].sort().join('|');
      case 'number':
        return `${cell.value}`;
      case 'text':
        return cell.text ?? '∅';
      case 'years':
        return `${cell.start}–${cell.end}`;
      case 'money':
        return `${cell.currency}${cell.amount}${cell.year}`;
    }
  }

  const differing = $derived.by(() => {
    const set = new Set<string>();
    if (loaded.length < 2) return set;
    for (const row of rows) {
      const first = signature(loaded[0]!.cells[row.key]);
      if (loaded.some((entry) => signature(entry.cells[row.key]) !== first)) set.add(row.key);
    }
    return set;
  });

  const visibleRows = $derived(
    hideIdentical && loaded.length > 1 ? rows.filter((row) => differing.has(row.key)) : rows,
  );

  const visibleGroups = $derived(
    groups
      .map((group) => ({ group, rows: visibleRows.filter((row) => row.group === group) }))
      .filter((bucket) => bucket.rows.length > 0),
  );

  const hiddenCount = $derived(rows.length - visibleRows.length);

  /* ── Formatting ─────────────────────────────────────────────────────── */

  const STATUS_LABEL: Record<string, string> = {
    verified: '',
    estimated: 'estimated',
    placeholder: 'not recorded',
    'conflicting-sources': 'sources disagree',
  };

  const STATUS_CLASS: Record<string, string> = {
    verified: 'text-status-verified',
    estimated: 'text-status-estimated',
    placeholder: 'text-status-placeholder',
    'conflicting-sources': 'text-status-conflicting',
  };

  const money = (cell: Extract<CompareCell, { kind: 'money' }>): string =>
    cell.amount === null
      ? 'not recorded'
      : `${cell.currency} ${cell.amount.toLocaleString('en-GB')} · ${cell.year} · ${cell.market}`;

  const years = (cell: Extract<CompareCell, { kind: 'years' }>): string =>
    cell.start === null ? 'not recorded' : cell.end === null ? `${cell.start}–present` : `${cell.start}–${cell.end}`;
</script>

{#snippet statusBadge(status: string)}
  {#if STATUS_LABEL[status]}
    <span
      class={`type-data whitespace-nowrap rounded-sm border border-current/30 px-1 text-[0.65rem] uppercase tracking-wide ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  {/if}
{/snippet}

<!--
  Both unit strings are in the markup and CSS shows one, exactly as the static
  pages do. A converter here would be a second answer to "what is this in
  inches" — see `lib/render/format.ts`.
-->
{#snippet units(value: number | null, unit: string)}
  {@const formatted = formatValue(value, unit)}
  {#if formatted === null}
    <span class="text-ink-muted">not recorded</span>
  {:else if formatted.identical}
    <span class="tabular-nums text-ink">{formatted.metric}</span>
  {:else}
    <span class="tabular-nums text-ink">
      <span class="u-metric">{formatted.metric}</span><span class="u-imperial" data-pagefind-ignore
        >{formatted.imperial}</span
      >
    </span>
  {/if}
{/snippet}

{#snippet bar(percentile: { fraction: number; percentile: number; populationSize: number; setLabel: string } | undefined)}
  {#if percentile}
    <!--
      SPEC.md §8.5: the length is a position in a stated population, and the
      population is named in the DOM rather than in a tooltip. A bar whose
      population is unstated is the unitless score that section rejects.
    -->
    <div class="mt-1">
      <div class="h-1 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          class="h-full rounded-full bg-ui-accent"
          style={`width: ${Math.max(2, Math.round(percentile.fraction * 100))}%`}
        ></div>
      </div>
      <p class="type-data mt-0.5 text-[0.6rem] text-ink-muted">
        {ordinal(percentile.percentile)} percentile among {percentile.setLabel} (n = {percentile.populationSize})
      </p>
    </div>
  {/if}
{/snippet}

{#snippet cellView(row: CompareRow, entry: CompareEntry)}
  {@const cell = entry.cells[row.key]}
  {#if !cell}
    <span class="text-ink-muted">—</span>
  {:else if cell.kind === 'scalar'}
    <div class="flex flex-wrap items-baseline gap-1.5">
      {@render units(cell.value, row.unit ?? '')}
      {@render statusBadge(cell.status)}
      {#if cell.sourceUrl}
        <a href={cell.sourceUrl} rel="nofollow noopener" class="text-[0.65rem] text-ui-accent">source</a>
      {/if}
    </div>
    {@render bar(cell.percentile)}
  {:else if cell.kind === 'derived'}
    <div class="flex flex-wrap items-baseline gap-1.5">
      {@render units(cell.derived.value, row.unit ?? '')}
      {@render statusBadge(cell.derived.status)}
      <button
        type="button"
        popovertarget={`f-${entry.id}-${row.key}`}
        class="disclosure-trigger"
        aria-label={`How ${row.label} was calculated for ${entry.name}`}
      >
        <span aria-hidden="true" class="font-serif italic">ƒ</span>
      </button>
    </div>
    {@render bar(cell.percentile)}
    <div id={`f-${entry.id}-${row.key}`} popover class="disclosure-panel">
      <h3 class="type-heading text-sm">{row.label} · {entry.name}</h3>
      <p class="type-data mt-2 rounded bg-surface-2 px-2 py-1 text-sm text-ink">
        {cell.derived.formula}
      </p>
      {#if cell.derived.value === null}
        <p class="type-data mt-3 text-sm text-status-placeholder">
          Not calculated: <strong>{cell.derived.blockedBy}</strong> has no sourced figure yet.
          Nothing is substituted for a missing input.
        </p>
      {:else}
        <ul class="mt-3 flex flex-col gap-2">
          {#each cell.derived.inputs as input (input.label)}
            <li class="type-data flex flex-wrap items-baseline gap-x-2 text-sm">
              <span class="text-ink-secondary">{input.label}</span>
              {@render units(input.value, input.unit)}
              {@render statusBadge(input.status)}
              {#if input.sourceUrl}
                <a href={input.sourceUrl} rel="nofollow noopener" class="text-xs text-ui-accent">
                  source
                </a>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if cell.derived.assumptions.length > 0}
        <ul class="type-data mt-3 flex list-disc flex-col gap-1 pl-4 text-xs text-ink-secondary">
          {#each cell.derived.assumptions as assumption (assumption)}
            <li>{assumption}</li>
          {/each}
        </ul>
      {/if}
      <button
        type="button"
        popovertarget={`f-${entry.id}-${row.key}`}
        popovertargetaction="hide"
        class="type-data mt-3 text-xs text-ui-accent">Close</button
      >
    </div>
  {:else if cell.kind === 'enum'}
    <span class="text-ink">{cell.label ?? '—'}</span>
  {:else if cell.kind === 'list'}
    {#if cell.terms.length === 0}
      <span class="text-ink-muted">—</span>
    {:else}
      <ul class="flex flex-wrap gap-1">
        {#each cell.terms as term (term.id)}
          <li class="rounded-full border border-line px-1.5 py-0.5 text-[0.65rem] text-ink-secondary">
            {term.label}
          </li>
        {/each}
      </ul>
    {/if}
  {:else if cell.kind === 'number'}
    <!-- No thousands separator: these rows are years and counts, and 1902 is
         not "1,902". See the same note in `SpecTable.astro`. -->
    <span class="tabular-nums text-ink">{cell.value === null ? '—' : String(cell.value)}</span>
  {:else if cell.kind === 'text'}
    <span class="text-ink">{cell.text ?? '—'}</span>
  {:else if cell.kind === 'years'}
    <span class="tabular-nums text-ink">{years(cell)}</span>
  {:else if cell.kind === 'money'}
    <div class="flex flex-wrap items-baseline gap-1.5">
      <span class={cell.amount === null ? 'text-ink-muted' : 'text-ink'}>{money(cell)}</span>
      {#if cell.amount !== null}{@render statusBadge(cell.status)}{/if}
    </div>
  {/if}
{/snippet}

<div class="mt-6">
  <div class="flex flex-wrap items-center gap-4">
    <label class="type-data flex items-center gap-2 text-sm text-ink-secondary">
      <input type="checkbox" bind:checked={highlight} class="accent-[var(--color-ui-accent)]" />
      Highlight differences
    </label>
    <label class="type-data flex items-center gap-2 text-sm text-ink-secondary">
      <input type="checkbox" bind:checked={hideIdentical} class="accent-[var(--color-ui-accent)]" />
      Hide identical rows
      {#if hideIdentical && hiddenCount > 0}
        <span class="text-ink-muted">({hiddenCount} hidden)</span>
      {/if}
    </label>

    {#if ids.length < limit}
      <button
        type="button"
        onclick={openPicker}
        class="type-data ml-auto rounded border border-line-strong bg-surface-1 px-3 py-1.5 text-sm text-ink"
      >
        {picking ? 'Close' : 'Add an entry'}
      </button>
    {/if}
  </div>

  {#if picking}
    <div class="mt-3 rounded-lg border border-line bg-surface-1 p-3">
      <label class="flex flex-col gap-1">
        <span class="type-data text-xs uppercase tracking-widest text-ink-muted">
          Find an entry by name or alias
        </span>
        <input
          type="search"
          bind:value={query}
          placeholder="Name or alias"
          class="type-data w-full rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
        />
      </label>
      {#if catalogue === null}
        <p class="type-data mt-2 text-xs text-ink-muted">Loading the catalogue…</p>
      {:else if query.trim() !== '' && suggestions.length === 0}
        <p class="type-data mt-2 text-xs text-ink-muted">Nothing matches that.</p>
      {:else}
        <ul class="mt-2 flex flex-col gap-1">
          {#each suggestions as row (row.id)}
            <li>
              <button
                type="button"
                onclick={() => add(row.id)}
                class="type-data w-full rounded px-2 py-1 text-left text-sm text-ink hover:bg-surface-2"
              >
                {row.name}
                <span class="text-ink-muted">{row.makerName ?? ''}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if failed.length > 0}
    <p class="type-data mt-4 rounded border border-line bg-surface-1 p-3 text-sm text-status-conflicting">
      No entry found for {failed.join(', ')}. The rest of the comparison is below.
    </p>
  {/if}

  {#if loading}
    <p class="type-data mt-6 text-sm text-ink-secondary">Loading…</p>
  {:else if loaded.length === 0}
    <p
      class="type-data mt-6 rounded-lg border border-dashed border-line-strong bg-surface-1 p-6 text-sm text-ink-muted"
    >
      Nothing is selected yet. Add an entry above, or press Compare on any entry page — the tray at
      the foot of the screen carries your selection from page to page.
    </p>
  {:else}
    <div class="compare-scroll mt-6 overflow-x-auto">
      <!--
        The width is stated rather than left to the table algorithm. A `min-width`
        on a cell is advisory in table layout, so on a narrow screen the first
        entry column collapsed to about half its minimum and its values were
        clipped behind the sticky label column. Giving the table its own minimum
        makes the scroller actually scroll, which is what the sticky column and
        the scroll-snap were both there for.
      -->
      <table
        class="compare-table type-data w-full text-sm"
        style={`min-width: ${9 + loaded.length * 11}rem`}
      >
        <thead>
          <tr>
            <th scope="col" class="compare-label bg-surface-0 p-2 text-left align-bottom">
              <span class="type-data text-xs uppercase tracking-widest text-ink-muted">Row</span>
            </th>
            {#each loaded as entry (entry.id)}
              <th scope="col" class="compare-col p-2 text-left align-bottom">
                <div class="flex flex-col gap-1">
                  {#if entry.typeLabel}
                    <span class="type-data text-[0.65rem] uppercase tracking-wider text-ink-muted">
                      {entry.typeLabel}
                    </span>
                  {/if}
                  {#if entry.hasPage}
                    <a href={`${gunPrefix}${entry.id}/`} class="type-title text-base text-ui-accent">
                      {entry.name}
                    </a>
                  {:else}
                    <span class="type-title text-base text-ink">{entry.name}</span>
                  {/if}
                  <span class="type-data text-xs text-ink-muted">{entry.makerName ?? ''}</span>
                  <button
                    type="button"
                    onclick={() => remove(entry.id)}
                    class="type-data self-start text-xs text-ui-accent"
                  >
                    Remove
                  </button>
                </div>
              </th>
            {/each}
          </tr>
        </thead>

        <!--
          ── The photographs ────────────────────────────────────────────────
          First row under the header, before any figure. A comparison of four
          arms is a comparison of four objects, and the reader knows what they
          look like long before they know what a 7.62×39mm case length is —
          the picture is what tells them they picked the right four.

          `object-contain` on a fixed-height box, not `cover`: these are
          specimen photographs at wildly different aspect ratios, and cropping
          a rifle to fill a square is cropping off the rifle.
        -->
        <tbody>
          <tr>
            <th
              scope="row"
              class="compare-label bg-surface-0 p-2 text-left align-middle text-xs uppercase tracking-widest text-ink-muted"
            >
              Photograph
            </th>
            {#each loaded as entry (entry.id)}
              <td class="compare-col p-2 align-middle">
                {#if entry.thumb}
                  <img
                    src={entry.thumb.src}
                    alt={entry.thumb.alt}
                    width={entry.thumb.width}
                    height={entry.thumb.height}
                    loading="lazy"
                    decoding="async"
                    class="h-20 w-full rounded border border-line bg-surface-1 object-contain p-1"
                  />
                {:else}
                  <span class="type-data flex h-20 items-center justify-center rounded border border-dashed border-line-strong text-xs text-ink-muted">
                    no photograph
                  </span>
                {/if}
              </td>
            {/each}
          </tr>
        </tbody>

        {#each visibleGroups as bucket (bucket.group)}
          <tbody>
            <tr>
              <th
                scope="colgroup"
                colspan={loaded.length + 1}
                class="type-heading border-y border-line-strong bg-surface-2 p-2 text-left text-xs uppercase tracking-wider text-ink-muted"
              >
                {bucket.group}
              </th>
            </tr>
            {#each bucket.rows as row (row.key)}
              <tr
                class={highlight && differing.has(row.key) ? 'bg-surface-1' : ''}
              >
                <th scope="row" class="compare-label p-2 text-left align-top font-normal text-ink-secondary">
                  {row.label}
                </th>
                {#each loaded as entry (entry.id)}
                  <td class="compare-col border-l border-line p-2 align-top">
                    {@render cellView(row, entry)}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        {/each}
      </table>
    </div>

    <p class="type-data mt-4 max-w-note text-xs text-ink-muted">
      No column is marked as the winner, and none ever will be. Lighter is better for carry and
      worse for recoil; the site does not know which you are choosing for. Bar lengths are
      percentile positions within the population named beneath each one, never a score.
      <a href={comparePath} class="text-ui-accent">Reset</a>
    </p>
  {/if}
</div>
