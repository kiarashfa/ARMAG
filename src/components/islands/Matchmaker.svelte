<script lang="ts">
  /**
   * Matchmaker — SPEC.md §9.3, over `lib/math/matchmaker.ts`.
   *
   * Dealbreaker filters first, then weighted preference scoring, producing a
   * ranked list framed as **"matches your stated criteria"**, with the criteria
   * restated above it. The seven inputs are the seven §9.3 names, and the
   * scoring itself lives in `lib/math` — this island collects answers and
   * renders the result.
   *
   * ── The three things it must never become ─────────────────────────────────
   *  1. **A recommendation.** Every score component is a distance from
   *     something the reader asked for, in the reader's own terms. Nothing here
   *     is a judgement about an arm, and the fit figure is never shown as a
   *     rating out of anything.
   *  2. **A budget filter.** There is no price input. ARMAG holds launch MSRP
   *     and inflation adjustment, not market value, so a budget question would
   *     be a lie.
   *  3. **A legality filter.** No jurisdiction data exists on this site, and
   *     none will. It states what a firearm *is*, never what a reader *may do*.
   *
   * **Recoil tolerance is the input nobody else offers**, and it works because
   * free recoil is computed for every entry from sourced inputs — so the answer
   * carries the status of those inputs rather than a claim of its own.
   */
  import { describeCriteria, match, type Candidate, type MatchCriteria } from '../../lib/math/matchmaker.ts';
  import type { CatalogueRow } from '../../lib/content/catalogue.ts';

  interface VocabTerm {
    id: string;
    label: string;
  }

  interface Props {
    catalogueSrc: string;
    gunPrefix: string;
    /** Passed in so the island imports no vocabulary file. */
    vocab: { role: VocabTerm[]; action: VocabTerm[]; era: VocabTerm[] };
    cartridges: VocabTerm[];
  }

  const { catalogueSrc, gunPrefix, vocab, cartridges }: Props = $props();

  let rows = $state<CatalogueRow[]>([]);
  let state_ = $state<'loading' | 'ready' | 'failed'>('loading');

  let useTags = $state<string[]>([]);
  let actions = $state<string[]>([]);
  let eras = $state<string[]>([]);
  let cartridgeRefs = $state<string[]>([]);
  let maxLoadedMassKg = $state<number | null>(null);
  let minCapacity = $state<number | null>(null);
  let maxFreeRecoilJ = $state<number | null>(null);
  let showExcluded = $state(false);

  $effect(() => {
    fetch(catalogueSrc)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('not ok'))))
      .then((payload: { rows: CatalogueRow[] }) => {
        rows = payload.rows ?? [];
        state_ = 'ready';
      })
      .catch(() => {
        state_ = 'failed';
      });
  });

  const candidates = $derived<Candidate[]>(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type ?? undefined,
      action: row.action ?? undefined,
      roles: row.roles,
      cartridgeRefs: row.cartridgeRefs,
      era: row.era ?? undefined,
      loadedMassKg: row.loadedMassKg,
      capacity: row.capacity,
      freeRecoilJ: row.freeRecoilJ,
    })),
  );

  const criteria = $derived<MatchCriteria>({
    ...(useTags.length > 0 ? { useTags } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    ...(eras.length > 0 ? { eras } : {}),
    ...(cartridgeRefs.length > 0 ? { cartridgeRefs } : {}),
    ...(maxLoadedMassKg !== null ? { maxLoadedMassKg } : {}),
    ...(minCapacity !== null ? { minCapacity } : {}),
    ...(maxFreeRecoilJ !== null ? { maxFreeRecoilJ } : {}),
  });

  const outcome = $derived(match(candidates, criteria));
  const applied = $derived(describeCriteria(criteria));
  const anyCriteria = $derived(applied.length > 0);

  const statusOf = (id: string) => rows.find((row) => row.id === id)?.derivedStatus ?? 'verified';
  const hasPage = (id: string) => rows.find((row) => row.id === id)?.hasPage ?? false;

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
  }

  function reset() {
    useTags = [];
    actions = [];
    eras = [];
    cartridgeRefs = [];
    maxLoadedMassKg = null;
    minCapacity = null;
    maxFreeRecoilJ = null;
  }

  const numberOrNull = (raw: string): number | null => {
    const value = Number(raw);
    return raw.trim() === '' || !Number.isFinite(value) ? null : value;
  };
</script>

{#snippet chips(label: string, terms: VocabTerm[], selected: string[], pick: (id: string) => void)}
  <div class="flex flex-col gap-1">
    <span class="type-data text-xs uppercase tracking-widest text-ink-muted">{label}</span>
    <ul class="flex flex-wrap gap-1.5">
      {#each terms as term (term.id)}
        <li>
          <button
            type="button"
            onclick={() => pick(term.id)}
            aria-pressed={selected.includes(term.id)}
            class={`type-data rounded-full border px-2.5 py-0.5 text-xs ${
              selected.includes(term.id)
                ? 'border-line-strong bg-surface-2 text-ink'
                : 'border-line text-ink-secondary hover:text-ink'
            }`}
          >
            {term.label}
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/snippet}

{#snippet ceiling(label: string, hint: string, value: number | null, set: (next: number | null) => void, step: string)}
  <label class="flex flex-col gap-1">
    <span class="type-data text-xs uppercase tracking-widest text-ink-muted">{label}</span>
    <span class="type-data text-[0.65rem] text-ink-muted">{hint}</span>
    <input
      type="number"
      {step}
      min="0"
      value={value ?? ''}
      oninput={(event) => set(numberOrNull(event.currentTarget.value))}
      placeholder="no limit"
      class="type-data rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
    />
  </label>
{/snippet}

<div class="mt-8 grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
  <form class="flex min-w-0 flex-col gap-5 rounded-lg border border-line bg-surface-1 p-4">
    {@render chips('Intended use', vocab.role, useTags, (id) => (useTags = toggle(useTags, id)))}
    {@render chips('Action', vocab.action, actions, (id) => (actions = toggle(actions, id)))}
    {@render chips('Era', vocab.era, eras, (id) => (eras = toggle(eras, id)))}
    {#if cartridges.length > 0}
      {@render chips('Cartridge', cartridges, cartridgeRefs, (id) => (cartridgeRefs = toggle(cartridgeRefs, id)))}
    {/if}

    {@render ceiling(
      'Loaded mass at most',
      'kilograms, loaded — not the empty figure a spec sheet quotes',
      maxLoadedMassKg,
      (next) => (maxLoadedMassKg = next),
      '0.1',
    )}
    {@render ceiling('Capacity at least', 'rounds, primary chambering', minCapacity, (next) => (minCapacity = next), '1')}
    {@render ceiling(
      'Free recoil at most',
      'joules — a .22 rifle is near 1 J, a service rifle near 10, a magnum rifle past 40',
      maxFreeRecoilJ,
      (next) => (maxFreeRecoilJ = next),
      '1',
    )}

    <button type="button" onclick={reset} class="type-data self-start text-sm text-ui-accent">
      Clear every criterion
    </button>

    <p class="type-data text-xs text-ink-muted">
      There is no price question here and there never will be: ARMAG holds launch prices, not market
      values, so a budget filter would be a lie. There is no legality question either — the site
      states what a firearm is, not what you may do with one.
    </p>
  </form>

  <div class="min-w-0">
    {#if state_ === 'loading'}
      <p class="type-data text-sm text-ink-secondary">Loading the catalogue…</p>
    {:else if state_ === 'failed'}
      <p class="type-data text-sm text-status-conflicting">
        The catalogue could not be loaded, so nothing can be matched against it.
      </p>
    {:else}
      <div class="rounded-lg border border-line bg-surface-1 p-4">
        <h2 class="type-heading text-sm uppercase tracking-wider text-ink-muted">
          {outcome.matches.length}
          {outcome.matches.length === 1 ? 'entry matches' : 'entries match'} your stated criteria
        </h2>
        {#if anyCriteria}
          <ul class="type-data mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-secondary">
            {#each applied as line (line)}
              <li>{line}</li>
            {/each}
          </ul>
        {:else}
          <p class="type-data mt-2 text-sm text-ink-secondary">
            You have stated none, so every entry matches equally and the order below is
            alphabetical. That is the honest answer to "show me everything".
          </p>
        {/if}
      </div>

      <ol class="mt-4 flex flex-col gap-3">
        {#each outcome.matches.slice(0, 30) as result (result.candidate.id)}
          <li class="rounded-lg border border-line bg-surface-1 p-4">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              {#if hasPage(result.candidate.id)}
                <a href={`${gunPrefix}${result.candidate.id}/`} class="type-title text-base text-ui-accent">
                  {result.candidate.name}
                </a>
              {:else}
                <span class="type-title text-base text-ink">{result.candidate.name}</span>
              {/if}
              {#if statusOf(result.candidate.id) !== 'verified'}
                <span class="type-data text-xs text-status-estimated">
                  its mass or recoil figure rests on an estimated input
                </span>
              {/if}
            </div>

            {#if result.reasons.length > 0}
              <ul class="type-data mt-2 flex flex-col gap-1 text-sm text-ink-secondary">
                {#each result.reasons as reason (reason.criterion)}
                  <li>
                    <span class="text-ink-muted">{reason.criterion}:</span>
                    {reason.detail}
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ol>

      {#if outcome.matches.length > 30}
        <p class="type-data mt-3 text-sm text-ink-muted">
          Showing the first 30 of {outcome.matches.length}. Narrow a criterion to shorten the list.
        </p>
      {/if}

      {#if outcome.excluded.length > 0}
        <div class="mt-6">
          <button
            type="button"
            onclick={() => (showExcluded = !showExcluded)}
            class="type-data text-sm text-ui-accent"
          >
            {showExcluded ? 'Hide' : 'Show'} the {outcome.excluded.length} entries a dealbreaker removed
          </button>
          {#if showExcluded}
            <ul class="type-data mt-2 flex flex-col gap-1 text-sm text-ink-secondary">
              {#each outcome.excluded.slice(0, 60) as exclusion (exclusion.candidate.id)}
                <li>
                  <span class="text-ink">{exclusion.candidate.name}</span>
                  <span class="text-ink-muted"> — {exclusion.because}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <p class="type-data mt-6 max-w-readable text-xs text-ink-muted">
        Ranking is on physical and technical fit only, never on effectiveness — for any use tag. An
        entry whose figure is missing is kept rather than excluded: a gap in our data is not a fact
        about the arm.
      </p>
    {/if}
  </div>
</div>
