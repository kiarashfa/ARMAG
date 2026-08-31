<script lang="ts">
  /**
   * Scale comparison — SPEC.md §9.6, the interactive half of the silhouette.
   *
   * The gun page draws an entry against its family siblings at build time; this
   * lets a reader draw any four against each other. Both call `buildScene` in
   * `lib/render/silhouette.ts`, so the outline of one arm is the same outline in
   * both places.
   *
   * It reads the **compare payloads**, not the catalogue: an outline needs
   * length, height, barrel length and feed system, and `/compare/data/<slug>.json`
   * already carries all four. A second endpoint holding the same four fields
   * would be a second thing to keep in step.
   */
  import { untrack } from 'svelte';
  import { buildScene, type SilhouetteSubject } from '../../lib/render/silhouette.ts';
  import type { CompareCell, CompareEntry } from '../../lib/compare/entry.ts';
  import { formatValue } from '../../lib/render/format.ts';

  interface CatalogueRowLite {
    id: string;
    name: string;
    search: string;
    makerName: string | null;
  }

  interface Props {
    dataPrefix: string;
    catalogueSrc: string;
    gunPrefix: string;
    limit: number;
  }

  const { dataPrefix, catalogueSrc, gunPrefix, limit }: Props = $props();

  let ids = $state<string[]>([]);
  let entries = $state<Record<string, CompareEntry>>({});
  let catalogue = $state<CatalogueRowLite[] | null>(null);
  let query = $state('');
  let notFound = $state<string[]>([]);

  const ACCENT = {
    handgun: 'stroke-type-handgun',
    rifle: 'stroke-type-rifle',
    shotgun: 'stroke-type-shotgun',
    smg: 'stroke-type-smg',
    machinegun: 'stroke-type-machinegun',
    platform: 'stroke-type-platform',
  } as const;

  /** Kept in step with `taxonomy.ts`; six accents cover the eight types. */
  const ACCENT_FOR: Record<string, keyof typeof ACCENT> = {
    pistol: 'handgun',
    revolver: 'handgun',
    rifle: 'rifle',
    carbine: 'rifle',
    shotgun: 'shotgun',
    'submachine-gun': 'smg',
    pdw: 'smg',
    'machine-gun': 'machinegun',
  };

  const scalar = (cell: CompareCell | undefined): number | null =>
    cell?.kind === 'scalar' ? cell.value : null;

  const listHas = (cell: CompareCell | undefined, ...wanted: string[]): boolean =>
    cell?.kind === 'list' && cell.terms.some((term) => wanted.includes(term.id));

  const subjectOf = (entry: CompareEntry): SilhouetteSubject => ({
    id: entry.id,
    name: entry.name,
    type: entry.type,
    lengthMm: scalar(entry.cells.length),
    heightMm: scalar(entry.cells.height),
    barrelLengthMm: scalar(entry.cells.barrelLength),
    hasMagazine: listHas(entry.cells.feedSystem, 'detachable-box', 'drum'),
  });

  const chosen = $derived(
    ids.map((id) => entries[id]).filter((entry): entry is CompareEntry => !!entry),
  );

  const scene = $derived(buildScene(chosen.map(subjectOf)));

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
    } catch {
      if (!notFound.includes(id)) notFound = [...notFound, id];
    }
  }

  // `untrack` for the same reason as `CompareTool`: this effect writes `ids`
  // and `entries`, and `load` reads `entries`. Without it the effect re-runs
  // itself until Svelte gives up.
  $effect(() => {
    untrack(() => {
      const initial = (new URLSearchParams(location.search).get('guns') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, limit);
      ids = initial;
      void Promise.all(initial.map(load));
    });

    fetch(catalogueSrc)
      .then((response) => response.json())
      .then((payload: { rows: CatalogueRowLite[] }) => {
        catalogue = payload.rows ?? [];
      })
      .catch(() => {
        catalogue = [];
      });
  });

  const suggestions = $derived.by(() => {
    if (!catalogue || query.trim() === '') return [];
    const needle = query.trim().toLowerCase();
    return catalogue.filter((row) => row.search.includes(needle) && !ids.includes(row.id)).slice(0, 8);
  });

  function add(id: string) {
    if (ids.includes(id) || ids.length >= limit) return;
    ids = [...ids, id];
    query = '';
    writeUrl();
    void load(id);
  }

  function remove(id: string) {
    ids = ids.filter((other) => other !== id);
    writeUrl();
  }

  const mm = (value: number) => formatValue(value, 'mm');
</script>

<div class="mt-8 flex flex-col gap-6">
  <div class="rounded-lg border border-line bg-surface-1 p-4">
    <div class="flex flex-wrap items-end gap-3">
      <label class="flex min-w-56 flex-1 flex-col gap-1">
        <span class="type-data text-xs uppercase tracking-widest text-ink-muted">
          Add an entry ({ids.length} of {limit})
        </span>
        <input
          type="search"
          bind:value={query}
          disabled={ids.length >= limit}
          placeholder="Name or alias"
          class="type-data w-full rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink disabled:opacity-50"
        />
      </label>
    </div>

    {#if suggestions.length > 0}
      <ul class="mt-2 flex flex-col gap-1">
        {#each suggestions as row (row.id)}
          <li>
            <button
              type="button"
              onclick={() => add(row.id)}
              class="type-data w-full rounded px-2 py-1 text-left text-sm text-ink hover:bg-surface-2"
            >
              {row.name} <span class="text-ink-muted">{row.makerName ?? ''}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if catalogue === null}
      <p class="type-data mt-2 text-xs text-ink-muted">Loading the catalogue…</p>
    {/if}

    {#if chosen.length > 0}
      <ul class="mt-3 flex flex-wrap gap-2">
        {#each chosen as entry (entry.id)}
          <li class="type-data flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs">
            <a href={`${gunPrefix}${entry.id}/`} class="text-ink-secondary">{entry.name}</a>
            <button
              type="button"
              onclick={() => remove(entry.id)}
              class="text-ink-muted hover:text-ink"
              aria-label={`Remove ${entry.name}`}
            >
              ✕
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if notFound.length > 0}
      <p class="type-data mt-2 text-xs text-status-conflicting">
        No entry found for {notFound.join(', ')}.
      </p>
    {/if}
  </div>

  {#if scene.silhouettes.length === 0}
    <p class="type-data rounded-lg border border-dashed border-line-strong bg-surface-1 p-6 text-sm text-ink-muted">
      Nothing selected yet. Add up to {limit} entries and they are drawn against each other at true
      scale — aligned at the rear and at the bottom, so the only thing that changes between them is
      the thing being compared.
    </p>
  {:else}
    <figure class="rounded-lg border border-line bg-surface-1 p-4">
      <svg
        viewBox={`0 0 ${scene.widthMm} ${scene.heightMm}`}
        preserveAspectRatio="xMinYMax meet"
        class="silhouette-svg"
        role="img"
        aria-label={`Representative outlines at true scale: ${scene.silhouettes
          .map((entry) => `${entry.name}, ${Math.round(entry.lengthMm)} millimetres long`)
          .join('; ')}`}
      >
        {#each scene.silhouettes as silhouette, index (silhouette.id)}
          {@const accent = ACCENT_FOR[chosen.find((e) => e.id === silhouette.id)?.type ?? ''] ?? 'platform'}
          <g transform={`translate(0 ${scene.heightMm - silhouette.heightMm})`}>
            <path
              d={silhouette.path}
              class={`fill-none ${ACCENT[accent]}`}
              stroke-width={Math.max(scene.widthMm / 400, 1)}
              stroke-linejoin="round"
              opacity={index === 0 ? 1 : 0.72}
            />
          </g>
        {/each}
      </svg>

      <figcaption class="mt-3">
        <ul class="type-data flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {#each scene.silhouettes as silhouette (silhouette.id)}
            {@const length = mm(silhouette.lengthMm)}
            <li class="flex items-baseline gap-2">
              <span class="text-ink">{silhouette.name}</span>
              {#if length}
                <span class="tabular-nums text-ink-secondary">
                  <span class="u-metric">{length.metric}</span><span
                    class="u-imperial"
                    data-pagefind-ignore>{length.imperial}</span
                  >
                </span>
              {/if}
              {#if !silhouette.heightSourced}
                <span class="text-status-estimated">height not recorded</span>
              {/if}
            </li>
          {/each}
        </ul>

        <p class="type-data mt-3 max-w-note text-xs text-ink-muted">
          Representative outline — <strong class="text-ink-secondary">the dimensions are sourced,
          the shape is not.</strong> Overall length, and barrel length where recorded, come from each
          entry's own figures. The profile is a generic one for the firearm type and says nothing
          about any of these arms' actual contours.
        </p>

        {#if scene.omitted.length > 0}
          <p class="type-data mt-2 text-xs text-status-placeholder">
            Not drawn: {scene.omitted.map((entry) => `${entry.name} (${entry.because})`).join(', ')}.
          </p>
        {/if}
      </figcaption>
    </figure>
  {/if}
</div>
