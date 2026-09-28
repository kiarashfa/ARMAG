<script lang="ts">
  /**
   * One filter menu in the catalogue's toolbar.
   *
   * The catalogue's facets used to be a drawer of chip rows: eighty-odd chips
   * across seven labelled rows, and every new country or role made it taller. A
   * menu is one button however many terms the axis holds. Its list scrolls on
   * its own, and past ten terms it can be searched. Escape closes it and
   * returns focus; a click outside dismisses it.
   *
   * `multi` decides whether choosing a term adds to the selection or replaces
   * it. The counts beside each term are computed by the catalogue against every
   * other active filter, and a term arrives already in display order.
   */
  interface Term {
    id: string;
    label: string;
    count: number;
  }

  interface Props {
    label: string;
    terms: readonly Term[];
    selected: string[];
    multi: boolean;
    onchange: (next: string[]) => void;
    /** Stretch to fill the slot the toolbar gives it. */
    fill?: boolean;
  }

  const { label, terms, selected, multi, onchange, fill = false }: Props = $props();

  const SEARCH_FROM = 10;

  let open = $state(false);
  let filter = $state('');
  let root = $state<HTMLElement | null>(null);
  let button = $state<HTMLButtonElement | null>(null);

  const visible = $derived(
    filter.trim() === ''
      ? terms
      : terms.filter((t) => t.label.toLowerCase().includes(filter.trim().toLowerCase())),
  );

  function choose(id: string) {
    if (selected.includes(id)) onchange(selected.filter((x) => x !== id));
    else onchange(multi ? [...selected, id] : [id]);
  }

  function close(refocus = false) {
    open = false;
    filter = '';
    if (refocus) button?.focus();
  }

  $effect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class={`relative max-sm:static ${fill ? 'min-w-0 sm:flex-1' : ''}`} bind:this={root}>
  <button
    type="button"
    bind:this={button}
    aria-expanded={open}
    aria-haspopup="true"
    onclick={() => (open ? close() : (open = true))}
    class={`type-data inline-flex h-10 items-center gap-1.5 rounded border px-3 text-sm transition-colors ${fill ? 'w-full justify-between' : ''} ${
      selected.length > 0
        ? 'border-ui-accent bg-surface-2 text-ink'
        : 'border-line-strong text-ink-secondary hover:bg-surface-2 hover:text-ink'
    }`}
  >
    <span class="truncate">{label}</span>
    {#if selected.length > 0}
      <span class="rounded-full bg-ui-accent px-1.5 text-xs leading-[1.4] text-surface-0 tabular-nums">{selected.length}</span>
    {/if}
    <span aria-hidden="true" class="text-[9px] text-ink-muted">▾</span>
  </button>

  {#if open}
    <div
      role="group"
      aria-label={label}
      class="absolute left-0 top-[calc(100%+6px)] z-30 flex max-h-[min(380px,70vh)] w-max min-w-[230px] max-w-[min(320px,calc(100vw-2.5rem))] flex-col rounded-lg border border-line-strong bg-surface-1 p-2 shadow-xl max-sm:right-0 max-sm:w-auto max-sm:max-w-none"
    >
      {#if terms.length > SEARCH_FROM}
        <input
          type="search"
          bind:value={filter}
          placeholder={`Find ${label.toLowerCase()}`}
          aria-label={`Find ${label.toLowerCase()}`}
          class="type-data mb-1.5 w-full shrink-0 rounded border border-line-strong bg-surface-0 px-2.5 py-1.5 text-sm text-ink"
        />
      {/if}
      <ul class="min-h-0 overflow-y-auto overscroll-contain">
        {#each visible as term (term.id)}
          <li>
            <label
              class={`type-data flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-2 ${
                term.count === 0 && !selected.includes(term.id) ? 'opacity-45' : ''
              }`}
            >
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={multi ? undefined : `facet-${label}`}
                checked={selected.includes(term.id)}
                onclick={(e) => {
                  e.preventDefault();
                  choose(term.id);
                }}
                class="size-3.5 shrink-0 accent-[var(--color-ui-accent)]"
              />
              <span class="min-w-0 flex-1 text-ink">{term.label}</span>
              <span class="shrink-0 text-xs tabular-nums text-ink-muted">{term.count}</span>
            </label>
          </li>
        {:else}
          <li class="type-data px-2 py-2 text-sm text-ink-muted">Nothing matches “{filter}”.</li>
        {/each}
      </ul>
      {#if selected.length > 0}
        <button
          type="button"
          onclick={() => onchange([])}
          class="type-data mt-1.5 shrink-0 border-t border-line px-2 pt-2 text-left text-xs text-ink-muted hover:text-ui-accent"
        >
          Clear {label.toLowerCase()}
        </button>
      {/if}
    </div>
  {/if}
</div>
