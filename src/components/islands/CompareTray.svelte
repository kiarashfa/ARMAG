<script lang="ts">
  /**
   * The site-wide compare tray — SPEC.md §9.2.
   *
   * One island, in the shell, on every page. It owns two things:
   *
   *  1. **The tray itself** — up to four entries, persisted through
   *     `lib/storage` (versioned, namespaced, discarded whole if unreadable).
   *  2. **Every "Compare" control on the page**, wired by delegation from a
   *     `data-compare-add` attribute rather than by being a component.
   *
   * The second half is why the gun page's Compare control is a plain `<a>` to
   * `/compare/?guns=<slug>`: with JavaScript off it is a working link to a real
   * comparison of one entry, and with JavaScript on this island upgrades it in
   * place to an add/remove toggle. A button that does nothing without
   * JavaScript would have been the easy version and the wrong one.
   *
   * It renders nothing at all when the tray is empty, so it costs a fixed bar
   * of screen space only once a reader has asked for one.
   */
  import { COMPARE_LIMIT, compareTrayStore, type TrayItem } from '../../lib/storage/index.ts';

  interface Props {
    /** Base-aware `/compare/`, so the island never builds a path itself. */
    comparePath: string;
    gunPrefix: string;
  }

  const { comparePath, gunPrefix }: Props = $props();

  let items = $state<TrayItem[]>([]);
  let notice = $state('');
  let ready = $state(false);
  /** Measured, not assumed: the tray wraps to two rows on a narrow screen. */
  let trayHeight = $state(0);

  const inTray = (id: string): boolean => items.some((item) => item.id === id);

  const compareUrl = $derived(
    items.length > 0 ? `${comparePath}?guns=${items.map((item) => item.id).join(',')}` : comparePath,
  );

  function persist() {
    const outcome = compareTrayStore.write($state.snapshot(items));
    if (outcome === 'unavailable') {
      notice = 'Your browser will not let the site remember this tray after you leave the page.';
    }
  }

  function toggle(id: string, name: string) {
    if (inTray(id)) {
      items = items.filter((item) => item.id !== id);
    } else if (items.length >= COMPARE_LIMIT) {
      notice = `The tray holds ${COMPARE_LIMIT} entries. Remove one to add another.`;
      return;
    } else {
      items = [...items, { id, name }];
      notice = '';
    }
    persist();
  }

  function clear() {
    items = [];
    notice = '';
    compareTrayStore.clear();
  }

  /* ── Load, then adopt every compare control on the page ───────────────── */

  $effect(() => {
    const result = compareTrayStore.read();
    items = result.value ?? [];
    notice = result.notice;
    ready = true;

    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-compare-add]');
      if (!target) return;
      const id = target.dataset.compareAdd;
      const name = target.dataset.compareName ?? id;
      if (!id || !name) return;
      // Only now does the link stop being a link. Until this handler exists,
      // clicking it navigates to a real comparison.
      event.preventDefault();
      toggle(id, name);
    };

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  });

  /**
   * A fixed bar would sit on top of the last few lines of the page, so it
   * reserves its own space through the document element rather than by being
   * in the flow — which is what lets it stay put while the page scrolls.
   */
  $effect(() => {
    const visible = items.length > 0 || notice !== '';
    const root = document.documentElement;
    root.toggleAttribute('data-tray', visible);
    // A guessed height is wrong the moment the chips wrap to a second row, and
    // the symptom is the last line of every page hidden behind the tray.
    if (visible && trayHeight > 0) root.style.setProperty('--tray-height', `${trayHeight}px`);
    return () => {
      root.removeAttribute('data-tray');
      root.style.removeProperty('--tray-height');
    };
  });

  /**
   * Reflects tray membership onto the page's controls, so the gun page's
   * Compare button reads "In compare" without the page knowing this island
   * exists.
   */
  $effect(() => {
    if (!ready) return;
    const ids = new Set(items.map((item) => item.id));
    for (const node of document.querySelectorAll<HTMLElement>('[data-compare-add]')) {
      const id = node.dataset.compareAdd ?? '';
      const active = ids.has(id);
      node.setAttribute('aria-pressed', String(active));
      node.textContent = active ? 'In compare' : 'Compare';
    }
  });
</script>

{#if items.length > 0 || notice}
  <div
    bind:clientHeight={trayHeight}
    class="fixed inset-x-0 bottom-0 z-40 border-t border-line-strong bg-surface-1/95 backdrop-blur"
    data-pagefind-ignore
  >
    <div
      class="mx-auto flex max-w-(--layout-max) flex-wrap items-center gap-x-4 gap-y-2 px-(--layout-gutter) py-2"
    >
      {#if items.length > 0}
        <span class="type-data text-xs uppercase tracking-widest text-ink-muted">Compare</span>
        <ul class="flex min-w-0 flex-1 flex-wrap gap-2">
          {#each items as item (item.id)}
            <li
              class="type-data flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs"
            >
              <a href={`${gunPrefix}${item.id}/`} class="max-w-40 truncate text-ink-secondary">
                {item.name}
              </a>
              <button
                type="button"
                onclick={() => toggle(item.id, item.name)}
                class="text-ink-muted hover:text-ink"
                aria-label={`Remove ${item.name} from the comparison`}
              >
                ✕
              </button>
            </li>
          {/each}
        </ul>

        <a
          href={compareUrl}
          class="type-data shrink-0 rounded border border-line-strong bg-surface-2 px-3 py-1 text-xs text-ink no-underline"
        >
          Compare {items.length}
        </a>
        <button type="button" onclick={clear} class="type-data shrink-0 text-xs text-ui-accent">
          Clear
        </button>
      {/if}

      {#if notice}
        <!-- SPEC.md §9.9: an honest one-line notice, never a silent failure. -->
        <p class="type-data w-full text-xs text-status-estimated">{notice}</p>
      {/if}
    </div>
  </div>
{/if}
