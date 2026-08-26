<script lang="ts">
  /**
   * Full-text search — SPEC.md §9.1.
   *
   * Pagefind indexes `dist/` after the build, so its runtime does not exist
   * until then. It is loaded **lazily, on first open**, through a dynamic
   * import: the index is the largest asset on the site and almost every visit
   * never opens search, so paying for it on load would be the single worst line
   * in the §11 JavaScript budget.
   *
   * We drive Pagefind's JS API and render results ourselves rather than
   * dropping in its bundled UI, so the overlay uses the site's own tokens
   * instead of arriving with a second design system.
   *
   * Aliases are indexed because they are real text in the page — the "also
   * known as" line on every entry — rather than because of a special field.
   * That is why "M9" finds the arm whose title says something else.
   */
  interface Props {
    /** Base-aware path to the Pagefind runtime, e.g. `/ARMAG/pagefind/pagefind.js`. */
    bundle: string;
  }

  const { bundle }: Props = $props();

  interface Result {
    url: string;
    title: string;
    excerpt: string;
  }

  let dialog = $state<HTMLDialogElement | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  let query = $state('');
  let results = $state<Result[]>([]);
  let status = $state<'idle' | 'searching' | 'ready' | 'unavailable'>('idle');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pagefind: any = null;

  async function ensureLoaded() {
    if (pagefind) return true;
    try {
      // `/* @vite-ignore */` matters: the bundle is produced by Pagefind AFTER
      // Vite has finished, so letting Vite try to resolve it at build time
      // fails the build rather than the search.
      pagefind = await import(/* @vite-ignore */ bundle);
      await pagefind.init?.();
      return true;
    } catch {
      // In `astro dev` there is no index yet. Say so plainly instead of
      // leaving a search box that silently never returns anything.
      status = 'unavailable';
      return false;
    }
  }

  async function open() {
    dialog?.showModal();
    queueMicrotask(() => input?.focus());
    await ensureLoaded();
  }

  function close() {
    dialog?.close();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * The search runs from an effect on `query`, not from an `oninput` handler.
   *
   * `bind:value` is itself an input listener, so a second `oninput` on the same
   * element races it: whichever was registered first wins, and the handler can
   * read the value from *before* the keystroke. That is a bug that looks like
   * "search is one character behind" and is very easy to stare past. An effect
   * runs after the binding has settled, so there is no ordering to get wrong.
   */
  $effect(() => {
    const term = query.trim();
    clearTimeout(timer);

    if (term === '') {
      results = [];
      if (status !== 'unavailable') status = 'idle';
      return;
    }

    status = 'searching';
    // Debounced: Pagefind fetches index chunks per query, and firing on every
    // keystroke pulls down chunks nobody will read.
    timer = setTimeout(async () => {
      if (!(await ensureLoaded())) return;
      const search = await pagefind.search(term);
      const top = await Promise.all(search.results.slice(0, 12).map((r: any) => r.data()));
      results = top.map((data: any) => ({
        url: data.url,
        title: data.meta?.title ?? data.url,
        excerpt: data.excerpt ?? '',
      }));
      status = 'ready';
    }, 160);

    return () => clearTimeout(timer);
  });

  function onKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const typing =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable);

    if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
      event.preventDefault();
      open();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<button
  type="button"
  onclick={open}
  class="type-data flex items-center gap-2 rounded border border-line-strong bg-surface-1 px-2 py-1 text-xs text-ink-secondary hover:text-ink"
  aria-label="Search the site"
>
  Search
  <kbd class="rounded border border-line px-1 text-[0.65rem] text-ink-muted">/</kbd>
</button>

<dialog
  bind:this={dialog}
  onclose={() => {
    query = '';
    results = [];
  }}
  class="w-full max-w-readable rounded-lg border border-line-strong bg-surface-1 p-0 text-ink backdrop:bg-black/60"
>
  <div class="flex items-center gap-2 border-b border-line p-3">
    <input
      bind:this={input}
      bind:value={query}
      type="search"
      placeholder="Search firearms, cartridges, makers, glossary"
      class="type-data w-full bg-transparent px-1 py-1 text-base text-ink outline-none"
      aria-label="Search query"
    />
    <button type="button" onclick={close} class="type-data px-2 text-sm text-ink-muted" aria-label="Close search">
      Esc
    </button>
  </div>

  <div class="max-h-[60vh] overflow-y-auto p-3">
    {#if status === 'unavailable'}
      <p class="type-data text-sm text-ink-muted">
        The search index is built with the site, so it is not available on the development server.
        Browse by type, action, country or era instead — those are plain pages.
      </p>
    {:else if query.trim() === ''}
      <p class="type-data text-sm text-ink-muted">
        Search matches names, aliases and the text of every page. An arm found by its service
        designation is found by its alias, not its title.
      </p>
    {:else if status === 'searching'}
      <p class="type-data text-sm text-ink-muted">Searching…</p>
    {:else if results.length === 0}
      <p class="type-data text-sm text-ink-muted">Nothing matched “{query}”.</p>
    {:else}
      <ul class="flex flex-col gap-3">
        {#each results as result (result.url)}
          <li>
            <a href={result.url} class="type-data text-sm text-ui-accent">{result.title}</a>
            <p class="type-data mt-0.5 text-xs text-ink-secondary">{@html result.excerpt}</p>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</dialog>
