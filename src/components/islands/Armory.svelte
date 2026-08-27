<script lang="ts">
  /**
   * My Armory — SPEC.md §9.4.
   *
   * Numbered bays in a grid, with the empty ones visible: an armory is a
   * shelf, and a shelf you can see the gaps in is the point of having one.
   *
   * ── Everything here belongs to the visitor ────────────────────────────────
   * No account, no server, no request. The state lives in this browser through
   * `lib/storage`, and the two ways it can leave are both deliberate acts:
   *
   *  - **Share link** — slots and slugs. No ownership, no nicknames, no dates,
   *    no prices. Structurally so: `toShare()` names the three fields it
   *    copies, and the share schema is `.strict()` about them.
   *  - **Backup file** — everything, and labelled as everything, at the moment
   *    of download rather than in an about page.
   *
   * ── The arithmetic is not here ────────────────────────────────────────────
   * Service status, burn rate, the projection and the value estimate all come
   * from `lib/math/ownership.ts`, tested against fixed dates. An island is the
   * worst place on the site to keep untested arithmetic, and a visitor's own
   * records are the worst data to keep it about.
   */
  import { untrack } from 'svelte';

  import {
    addEntry,
    armoryStore,
    decodeShare,
    encodeShare,
    evictedBy,
    freeSlots,
    fromShare,
    moveEntry,
    removeEntry,
    setCapacity,
    toBackup,
    fromBackup,
    updateEntry,
    EMPTY_ARMORY,
    type ArmoryCapacity,
  } from '../../lib/storage/armory.ts';
  import {
    ARMORY_CAPACITIES,
    type ArmoryEntry,
    type ArmoryState,
    type NraConditionGrade,
    type ServiceEvent,
  } from '../../schemas/armory.ts';
  import {
    burnRate,
    monthsToNextService,
    ownedValue,
    serviceSpend,
    serviceStatus,
    type OwnershipFacts,
  } from '../../lib/math/ownership.ts';
  import type { CompareCell, CompareEntry } from '../../lib/compare/entry.ts';

  interface CatalogueRowLite {
    id: string;
    name: string;
    search: string;
    makerName: string | null;
    type: string | null;
    hasPage: boolean;
  }

  interface Props {
    catalogueSrc: string;
    dataPrefix: string;
    gunPrefix: string;
    armoryPath: string;
  }

  const { catalogueSrc, dataPrefix, gunPrefix, armoryPath }: Props = $props();

  const CONDITIONS: { id: NraConditionGrade; label: string }[] = [
    { id: 'new-100', label: 'New (100%)' },
    { id: 'excellent-95', label: 'Excellent (95%)' },
    { id: 'fine-80', label: 'Fine (80%)' },
    { id: 'very-good-70', label: 'Very good (70%)' },
    { id: 'good-60', label: 'Good (60%)' },
    { id: 'fair-40', label: 'Fair (40%)' },
    { id: 'poor-30', label: 'Poor (30%)' },
  ];

  const SERVICE_TYPES: ServiceEvent['type'][] = [
    'cleaning',
    'parts-replacement',
    'gunsmith',
    'inspection',
    'other',
  ];

  const today = (): string => new Date().toISOString().slice(0, 10);
  const newUid = (): string =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `uid-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  /* ── State ──────────────────────────────────────────────────────────── */

  let state = $state<ArmoryState>({ ...EMPTY_ARMORY });
  let notice = $state('');
  let ready = $state(false);

  let catalogue = $state<CatalogueRowLite[] | null>(null);
  let selectedUid = $state<string | null>(null);
  let addingToSlot = $state<number | null>(null);
  let query = $state('');

  /** Entry payloads, fetched only for the bay actually being looked at. */
  let details = $state<Record<string, CompareEntry | null>>({});

  let pendingCapacity = $state<ArmoryCapacity | null>(null);
  let shareUrl = $state('');
  let copied = $state(false);
  let importText = $state('');
  let incomingShare = $state<ArmoryState | null>(null);

  const byId = $derived(new Map((catalogue ?? []).map((row) => [row.id, row])));
  const selected = $derived(state.entries.find((entry) => entry.uid === selectedUid) ?? null);
  const bays = $derived(Array.from({ length: state.capacity }, (_, slot) => slot));
  const occupant = (slot: number): ArmoryEntry | undefined =>
    state.entries.find((entry) => entry.slot === slot);

  const nameOf = (entry: ArmoryEntry): string =>
    entry.nickname || byId.get(entry.gunRef)?.name || entry.gunRef;

  const ownedCount = $derived(state.entries.filter((entry) => entry.ownership).length);

  /* ── Persistence ────────────────────────────────────────────────────── */

  function persist(next: ArmoryState) {
    state = { ...next, updatedAt: today() };
    const outcome = armoryStore.write($state.snapshot(state));
    if (outcome === 'unavailable') {
      notice =
        'Your browser will not let this site store anything, so nothing here will be remembered after you leave. Take a backup before you close the tab.';
    }
  }

  /*
   * `untrack`: this effect writes `state` and reads nothing reactive. Without
   * it the fetches and the URL handling below would re-enter on every write —
   * the failure that hung the compare tool (CLAUDE.md item 113).
   */
  $effect(() => {
    untrack(() => {
      const result = armoryStore.read();
      if (result.value) state = result.value;
      notice = result.notice;
      ready = true;

      const params = new URLSearchParams(location.search);

      const shareToken = params.get('share');
      if (shareToken) {
        const share = decodeShare(shareToken);
        incomingShare = share ? fromShare(share, today(), newUid) : null;
        if (!share) {
          notice = 'That share link could not be read. Nothing on this page has been changed.';
        }
      }

      const add = params.get('add');
      if (add && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(add)) {
        const alreadyFull = freeSlots(state).length === 0;
        if (alreadyFull) {
          notice = `Every bay is full, so ${add} was not added. Raise the capacity or clear a bay.`;
        } else {
          persist(addEntry(state, { uid: newUid(), gunRef: add, addedAt: today() }));
          notice = '';
        }
        // The parameter has been acted on; leaving it in the URL would add the
        // same arm again on every reload.
        history.replaceState(null, '', location.pathname);
      }
    });

    fetch(catalogueSrc)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('not ok'))))
      .then((payload: { rows: CatalogueRowLite[] }) => {
        catalogue = payload.rows ?? [];
      })
      .catch(() => {
        catalogue = [];
      });
  });

  /** The entry payload for the open bay, fetched once and remembered. */
  $effect(() => {
    const entry = selected;
    if (!entry || entry.gunRef in details) return;
    const gunRef = entry.gunRef;
    fetch(`${dataPrefix}${gunRef}.json`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('not ok'))))
      .then((payload: CompareEntry) => {
        details[gunRef] = payload;
      })
      .catch(() => {
        details[gunRef] = null;
      });
  });

  /* ── Actions ────────────────────────────────────────────────────────── */

  function addFromCatalogue(gunRef: string) {
    const slot = addingToSlot ?? undefined;
    const uid = newUid();
    persist(addEntry(state, { uid, gunRef, addedAt: today(), ...(slot !== undefined ? { slot } : {}) }));
    addingToSlot = null;
    query = '';
    selectedUid = uid;
  }

  function askCapacity(capacity: ArmoryCapacity) {
    if (capacity === state.capacity) return;
    const losing = evictedBy(state, capacity);
    if (losing.length === 0) {
      persist(setCapacity(state, capacity));
      return;
    }
    // SPEC.md §9.4: downsizing warns before eviction.
    pendingCapacity = capacity;
  }

  function confirmCapacity() {
    if (pendingCapacity === null) return;
    persist(setCapacity(state, pendingCapacity));
    pendingCapacity = null;
  }

  const patchOwnership = (uid: string, change: Partial<OwnershipFacts>) => {
    persist(
      updateEntry(state, uid, (entry) => ({
        ...entry,
        ownership: {
          serviceLog: [],
          valueAnchors: [],
          ...entry.ownership,
          ...change,
        },
      })),
    );
  };

  function toggleOwned(entry: ArmoryEntry) {
    persist(
      updateEntry(state, entry.uid, (existing) =>
        existing.ownership
          ? { uid: existing.uid, gunRef: existing.gunRef, slot: existing.slot, addedAt: existing.addedAt, ...(existing.nickname ? { nickname: existing.nickname } : {}), ...(existing.variantRef ? { variantRef: existing.variantRef } : {}) }
          : { ...existing, ownership: { serviceLog: [], valueAnchors: [] } },
      ),
    );
  }

  function logService(uid: string, event: ServiceEvent) {
    persist(
      updateEntry(state, uid, (entry) => ({
        ...entry,
        ownership: {
          serviceLog: [],
          valueAnchors: [],
          ...entry.ownership,
          serviceLog: [...(entry.ownership?.serviceLog ?? []), event].sort((a, b) =>
            a.date.localeCompare(b.date),
          ),
        },
      })),
    );
  }

  function makeShareLink() {
    shareUrl = `${location.origin}${armoryPath}?share=${encodeShare(state)}`;
    copied = false;
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      copied = true;
    } catch {
      copied = false;
      notice = 'The clipboard is not available here. The link is in the box — select it and copy.';
    }
  }

  const backupHref = $derived(
    `data:application/json;charset=utf-8,${encodeURIComponent(toBackup(state))}`,
  );

  function importBackup() {
    const restored = fromBackup(importText);
    if (!restored) {
      notice = 'That file is not an ARMAG backup this version can read. Nothing has been changed.';
      return;
    }
    persist(restored);
    importText = '';
    notice = 'Backup restored. It replaced what was here.';
  }

  function acceptShare() {
    if (!incomingShare) return;
    persist(incomingShare);
    incomingShare = null;
    notice = 'Shared layout loaded. It carried no ownership data — share links never do.';
    history.replaceState(null, '', location.pathname);
  }

  /* ── Number formatting, shared with the rest of the site ─────────────── */

  const money = (value: number | null): string =>
    value === null ? '—' : value.toLocaleString('en-GB', { maximumFractionDigits: 2 });

  const launchPrice = (gunRef: string): Extract<CompareCell, { kind: 'money' }> | null => {
    const cell = details[gunRef]?.cells.launchPrice;
    return cell?.kind === 'money' && cell.amount !== null ? cell : null;
  };

  /** The facts `lib/math/ownership.ts` reads, with its defaults filled in. */
  const factsOf = (entry: ArmoryEntry): OwnershipFacts => ({
    serviceLog: [],
    valueAnchors: [],
    ...entry.ownership,
  });

  /**
   * Takes `unknown` deliberately.
   *
   * `bind:value` on an `<input type="number">` hands back a NUMBER, while an
   * `oninput` handler reading `currentTarget.value` hands back a string — and
   * both call this. Typing it `string` compiled cleanly and threw
   * `raw.trim is not a function` the moment anyone logged a service, which is
   * the kind of failure that only shows up by using the thing.
   */
  const numberOrUndefined = (raw: unknown): number | undefined => {
    if (raw === null || raw === undefined || raw === '') return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };

  const suggestions = $derived.by(() => {
    if (!catalogue || query.trim() === '') return [];
    const needle = query.trim().toLowerCase();
    return catalogue.filter((row) => row.search.includes(needle)).slice(0, 8);
  });

  /* Draft service event, for the one entry being edited. */
  let draftDate = $state('');
  let draftType = $state<ServiceEvent['type']>('cleaning');
  // `string | number`: empty is '', and `bind:value` on a number input replaces
  // it with a number the moment anyone types.
  let draftRounds = $state<string | number>('');
  let draftCost = $state<string | number>('');
  let draftNotes = $state('');

  function submitService(uid: string) {
    const date = draftDate || today();
    logService(uid, {
      date,
      type: draftType,
      ...(numberOrUndefined(draftRounds) !== undefined ? { rounds: numberOrUndefined(draftRounds)! } : {}),
      ...(numberOrUndefined(draftCost) !== undefined ? { cost: numberOrUndefined(draftCost)! } : {}),
      ...(draftNotes.trim() ? { notes: draftNotes.trim() } : {}),
    });
    draftDate = '';
    draftRounds = '';
    draftCost = '';
    draftNotes = '';
  }

  let anchorDate = $state('');
  let anchorValue = $state<string | number>('');

  function submitAnchor(entry: ArmoryEntry) {
    const value = numberOrUndefined(anchorValue);
    if (value === undefined) return;
    patchOwnership(entry.uid, {
      valueAnchors: [
        ...(entry.ownership?.valueAnchors ?? []),
        { date: anchorDate || today(), value },
      ].sort((a, b) => a.date.localeCompare(b.date)),
    });
    anchorDate = '';
    anchorValue = '';
  }
</script>

{#snippet field(label: string, hint = '')}
  <span class="type-data text-xs uppercase tracking-widest text-ink-muted">{label}</span>
  {#if hint}<span class="type-data text-[0.65rem] text-ink-muted">{hint}</span>{/if}
{/snippet}

<div class="mt-8">
  {#if notice}
    <!-- SPEC.md §9.9: an honest one-line notice, never a silent failure. -->
    <p class="type-data mb-4 rounded-lg border border-line-strong bg-surface-1 p-3 text-sm text-status-estimated">
      {notice}
    </p>
  {/if}

  {#if incomingShare}
    <div class="mb-4 rounded-lg border border-line-strong bg-surface-1 p-4">
      <h2 class="type-heading text-sm text-ink">A shared armory is in this link</h2>
      <p class="type-body mt-2 max-w-readable text-sm text-ink-secondary">
        {incomingShare.entries.length} bays, laid out by whoever sent it. It carries no ownership
        data — share links never do. Loading it <strong class="text-ink">replaces</strong> what is on
        this page now, so take a backup first if you want to keep it.
      </p>
      <div class="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onclick={acceptShare}
          class="type-data rounded border border-line-strong bg-surface-2 px-3 py-1.5 text-sm text-ink"
        >
          Load it
        </button>
        <button
          type="button"
          onclick={() => (incomingShare = null)}
          class="type-data text-sm text-ui-accent"
        >
          Keep what I have
        </button>
      </div>
    </div>
  {/if}

  <!-- ── Capacity ──────────────────────────────────────────────────── -->
  <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="type-data text-xs uppercase tracking-widest text-ink-muted">Bays</span>
      {#each ARMORY_CAPACITIES as capacity (capacity)}
        <button
          type="button"
          onclick={() => askCapacity(capacity)}
          aria-pressed={state.capacity === capacity}
          class={`type-data rounded-full border px-3 py-0.5 text-xs ${
            state.capacity === capacity
              ? 'border-line-strong bg-surface-2 text-ink'
              : 'border-line text-ink-secondary hover:text-ink'
          }`}
        >
          {capacity}
        </button>
      {/each}
    </div>

    <p class="type-data text-sm text-ink-secondary">
      {state.entries.length} of {state.capacity} filled{ownedCount > 0
        ? `, ${ownedCount} marked as owned`
        : ''}
    </p>
  </div>

  {#if pendingCapacity !== null}
    {@const losing = evictedBy(state, pendingCapacity)}
    <div class="mt-3 rounded-lg border border-status-conflicting bg-surface-1 p-4">
      <p class="type-body max-w-readable text-sm text-ink">
        Dropping to {pendingCapacity} bays would remove
        <strong>{losing.length}</strong>
        {losing.length === 1 ? 'entry' : 'entries'}: {losing.map(nameOf).join(', ')}. Anything else
        keeps its bay, or moves to the lowest free one.
      </p>
      <div class="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onclick={confirmCapacity}
          class="type-data rounded border border-line-strong bg-surface-2 px-3 py-1.5 text-sm text-ink"
        >
          Remove {losing.length} and resize
        </button>
        <button
          type="button"
          onclick={() => (pendingCapacity = null)}
          class="type-data text-sm text-ui-accent"
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}

  <!-- ── The bays ──────────────────────────────────────────────────── -->
  <ul class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
    {#each bays as slot (slot)}
      {@const entry = occupant(slot)}
      <li>
        {#if entry}
          <button
            type="button"
            onclick={() => (selectedUid = selectedUid === entry.uid ? null : entry.uid)}
            aria-pressed={selectedUid === entry.uid}
            class={`flex h-full w-full flex-col gap-1 rounded-lg border p-3 text-left ${
              selectedUid === entry.uid
                ? 'border-line-strong bg-surface-2'
                : 'border-line bg-surface-1 hover:border-line-strong'
            }`}
          >
            <span class="type-data text-[0.65rem] tabular-nums text-ink-muted">
              Bay {slot + 1}
            </span>
            <span class="type-heading text-sm text-ink">{nameOf(entry)}</span>
            {#if entry.nickname && byId.get(entry.gunRef)}
              <span class="type-data text-xs text-ink-muted">{byId.get(entry.gunRef)!.name}</span>
            {/if}
            {#if entry.ownership}
              <span class="type-data text-[0.65rem] uppercase tracking-wide text-status-verified">
                owned
              </span>
            {/if}
          </button>
        {:else}
          <button
            type="button"
            onclick={() => {
              addingToSlot = slot;
              selectedUid = null;
            }}
            class={`flex h-full min-h-24 w-full flex-col items-start justify-between rounded-lg border border-dashed p-3 text-left ${
              addingToSlot === slot
                ? 'border-ui-accent bg-surface-1'
                : 'border-line-strong hover:bg-surface-1'
            }`}
          >
            <span class="type-data text-[0.65rem] tabular-nums text-ink-muted">Bay {slot + 1}</span>
            <span class="type-data text-sm text-ink-secondary">Empty · add</span>
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  <!-- ── Add ───────────────────────────────────────────────────────── -->
  {#if addingToSlot !== null}
    <div class="mt-4 rounded-lg border border-line bg-surface-1 p-4">
      <label class="flex min-w-0 flex-col gap-1">
        {@render field(`Fill bay ${addingToSlot + 1}`, 'Search by name or alias')}
        <input
          type="search"
          bind:value={query}
          placeholder="Name or alias"
          class="type-data w-full min-w-0 rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
        />
      </label>
      {#if catalogue === null}
        <p class="type-data mt-2 text-xs text-ink-muted">Loading the catalogue…</p>
      {:else if catalogue.length === 0}
        <p class="type-data mt-2 text-xs text-ink-muted">
          The catalogue could not be loaded, so there is nothing to choose from.
        </p>
      {:else if query.trim() !== '' && suggestions.length === 0}
        <p class="type-data mt-2 text-xs text-ink-muted">Nothing matches that.</p>
      {:else}
        <ul class="mt-2 flex flex-col gap-1">
          {#each suggestions as row (row.id)}
            <li>
              <button
                type="button"
                onclick={() => addFromCatalogue(row.id)}
                class="type-data w-full rounded px-2 py-1 text-left text-sm text-ink hover:bg-surface-2"
              >
                {row.name} <span class="text-ink-muted">{row.makerName ?? ''}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <button
        type="button"
        onclick={() => (addingToSlot = null)}
        class="type-data mt-3 text-sm text-ui-accent"
      >
        Cancel
      </button>
    </div>
  {/if}

  <!-- ── The open bay ──────────────────────────────────────────────── -->
  {#if selected}
    {@const entry = selected}
    {@const row = byId.get(entry.gunRef)}
    {@const facts = factsOf(entry)}
    {@const status = entry.ownership ? serviceStatus(facts, today()) : null}
    {@const rate = entry.ownership ? burnRate(facts, today()) : null}
    {@const projection = entry.ownership ? monthsToNextService(facts, today()) : null}
    {@const value = entry.ownership ? ownedValue(facts) : null}
    {@const spend = entry.ownership ? serviceSpend(facts) : null}
    {@const price = launchPrice(entry.gunRef)}

    <div class="mt-6 rounded-lg border border-line-strong bg-surface-1 p-4">
      <div class="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p class="type-data text-xs uppercase tracking-widest text-ink-muted">
            Bay {entry.slot + 1}
          </p>
          {#if row?.hasPage}
            <a href={`${gunPrefix}${entry.gunRef}/`} class="type-title text-xl text-ui-accent">
              {row.name}
            </a>
          {:else}
            <span class="type-title text-xl text-ink">{row?.name ?? entry.gunRef}</span>
          {/if}
          <p class="type-data text-xs text-ink-muted">Added {entry.addedAt}</p>
        </div>
        <button
          type="button"
          onclick={() => {
            persist(removeEntry(state, entry.uid));
            selectedUid = null;
          }}
          class="type-data rounded border border-line-strong bg-surface-2 px-3 py-1 text-xs text-ink-secondary hover:text-ink"
        >
          Empty this bay
        </button>
      </div>

      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <label class="flex min-w-0 flex-col gap-1">
          {@render field('Nickname', 'Yours. There is no serial number field on this site, and never will be')}
          <input
            type="text"
            maxlength="60"
            value={entry.nickname ?? ''}
            oninput={(event) =>
              persist(
                updateEntry(state, entry.uid, (existing) => {
                  const nickname = event.currentTarget.value.trim();
                  const { nickname: _drop, ...rest } = existing;
                  return nickname ? { ...rest, nickname } : rest;
                }),
              )}
            class="type-data w-full min-w-0 rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
          />
        </label>

        <label class="flex min-w-0 flex-col gap-1">
          {@render field('Move to bay', `1 to ${state.capacity}`)}
          <input
            type="number"
            min="1"
            max={state.capacity}
            value={entry.slot + 1}
            onchange={(event) => {
              const target = Number(event.currentTarget.value) - 1;
              if (Number.isFinite(target)) persist(moveEntry(state, entry.uid, target));
            }}
            class="type-data w-full min-w-0 rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
          />
        </label>
      </div>

      <label class="type-data mt-4 flex items-center gap-2 text-sm text-ink-secondary">
        <input
          type="checkbox"
          checked={!!entry.ownership}
          onchange={() => toggleOwned(entry)}
          class="accent-[var(--color-ui-accent)]"
        />
        I own this
      </label>

      {#if entry.ownership}
        <div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label class="flex min-w-0 flex-col gap-1">
            {@render field('Acquired', 'the date you got it')}
            <input
              type="date"
              value={entry.ownership.acquiredDate ?? ''}
              onchange={(event) =>
                patchOwnership(entry.uid, { acquiredDate: event.currentTarget.value || undefined })}
              class="type-data w-full min-w-0 rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
            />
          </label>

          <label class="flex min-w-0 flex-col gap-1">
            {@render field('Price paid', 'your currency, your figure')}
            <input
              type="number"
              min="0"
              step="1"
              value={entry.ownership.acquiredPrice ?? ''}
              oninput={(event) =>
                patchOwnership(entry.uid, {
                  acquiredPrice: numberOrUndefined(event.currentTarget.value),
                })}
              class="type-data w-full min-w-0 rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
            />
          </label>

          <label class="flex min-w-0 flex-col gap-1">
            {@render field('Condition', 'the NRA scale')}
            <select
              value={entry.ownership.condition ?? ''}
              onchange={(event) =>
                patchOwnership(entry.uid, {
                  condition: (event.currentTarget.value || undefined) as NraConditionGrade | undefined,
                })}
              class="type-data w-full min-w-0 rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
            >
              <option value="">Not graded</option>
              {#each CONDITIONS as grade (grade.id)}
                <option value={grade.id}>{grade.label}</option>
              {/each}
            </select>
          </label>

          <label class="flex min-w-0 flex-col gap-1">
            {@render field('Rounds fired', 'total, as you count it')}
            <input
              type="number"
              min="0"
              step="1"
              value={entry.ownership.roundCount ?? ''}
              oninput={(event) =>
                patchOwnership(entry.uid, {
                  roundCount: numberOrUndefined(event.currentTarget.value),
                })}
              class="type-data w-full min-w-0 rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
            />
          </label>

          <label class="flex min-w-0 flex-col gap-1">
            {@render field('Service every', 'rounds — yours to set')}
            <input
              type="number"
              min="1"
              step="1"
              value={entry.ownership.serviceIntervalRounds ?? ''}
              oninput={(event) =>
                patchOwnership(entry.uid, {
                  serviceIntervalRounds: numberOrUndefined(event.currentTarget.value),
                })}
              class="type-data w-full min-w-0 rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
            />
          </label>

          <label class="flex min-w-0 flex-col gap-1">
            {@render field('Service every', 'months — yours to set')}
            <input
              type="number"
              min="1"
              step="1"
              value={entry.ownership.serviceIntervalMonths ?? ''}
              oninput={(event) =>
                patchOwnership(entry.uid, {
                  serviceIntervalMonths: numberOrUndefined(event.currentTarget.value),
                })}
              class="type-data w-full min-w-0 rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
            />
          </label>
        </div>

        <p class="type-data mt-2 max-w-readable text-xs text-ink-muted">
          ARMAG never suggests a service interval. A wrong one is either a false alarm or a false
          all-clear, and neither is ours to issue.
        </p>

        <!-- ── Statistics ────────────────────────────────────────── -->
        <section class="mt-6">
          <h3 class="type-heading text-xs uppercase tracking-widest text-ink-muted">Statistics</h3>
          <div class="mt-3 grid gap-4 rounded-lg border border-line bg-surface-0 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div class="flex flex-col gap-1">
              <span class="type-data text-xs uppercase tracking-wider text-ink-muted">Service</span>
              {#if !status}
                <span class="type-data text-sm text-ink-muted">
                  No interval set, so nothing is due.
                </span>
              {:else if status.overdue}
                <span class="type-stat text-xl text-status-conflicting">Overdue</span>
                <span class="type-data text-xs text-ink-secondary">
                  {status.governedBy === 'rounds'
                    ? `${Math.abs(status.roundsRemaining ?? 0)} rounds past your interval`
                    : `${Math.abs(status.daysRemaining ?? 0)} days past ${status.nextDueDate}`}
                </span>
              {:else}
                <span class="type-stat text-xl text-ink">
                  {status.governedBy === 'rounds'
                    ? `${status.roundsRemaining} rds`
                    : `${status.daysRemaining} days`}
                </span>
                <span class="type-data text-xs text-ink-secondary">
                  {status.governedBy === 'rounds' ? 'until your round interval' : `until ${status.nextDueDate}`}
                </span>
              {/if}
              {#if status && status.roundsRemaining !== null && status.daysRemaining !== null}
                <!--
                  Both intervals are set, so the one that is not governing is
                  still shown. Rounds and days are not comparable quantities, so
                  the tool cannot pick a winner between them honestly — it shows
                  both and lets the owner decide which they care about.
                -->
                <span class="type-data text-[0.65rem] text-ink-muted">
                  {status.governedBy === 'rounds'
                    ? `Time interval: ${status.daysRemaining} days, ${status.nextDueDate}`
                    : `Round interval: ${status.roundsRemaining} rounds`}
                </span>
              {/if}
            </div>

            <div class="flex flex-col gap-1">
              <span class="type-data text-xs uppercase tracking-wider text-ink-muted">Burn rate</span>
              <span class="type-stat text-xl text-ink">
                {rate?.value === null || rate === null
                  ? '—'
                  : `${rate.value.toFixed(0)} rds/mo`}
              </span>
              <span class="type-data text-xs text-ink-secondary">
                {rate?.value === null ? `needs ${rate.blockedBy}` : 'averaged over your ownership'}
              </span>
            </div>

            <div class="flex flex-col gap-1">
              <span class="type-data text-xs uppercase tracking-wider text-ink-muted">
                Next service
              </span>
              <span class="type-stat text-xl text-ink">
                {projection?.value === null || projection === null || !Number.isFinite(projection.value)
                  ? '—'
                  : `${projection.value.toFixed(1)} mo`}
              </span>
              <span class="type-data text-xs text-ink-secondary">
                {projection?.value === null ? `needs ${projection.blockedBy}` : 'at your current rate'}
              </span>
            </div>

            <div class="flex flex-col gap-1">
              <span class="type-data text-xs uppercase tracking-wider text-ink-muted">Value</span>
              <span class="type-stat text-xl text-ink">{money(value?.value ?? null)}</span>
              <span class="type-data text-xs text-ink-secondary">
                {value === null ? 'needs a condition and a base you supply' : value.formula}
              </span>
            </div>
          </div>

          {#if status}
            <ul class="type-data mt-2 flex list-disc flex-col gap-1 pl-4 text-xs text-ink-muted">
              {#each status.basis as line (line)}
                <li>{line}</li>
              {/each}
            </ul>
          {/if}

          <p class="type-data mt-2 max-w-readable text-xs text-ink-muted">
            {#if spend && (spend.value ?? 0) > 0}
              You have logged {money(spend.value)} of service.
              {#if spend.assumptions.length > 0}{spend.assumptions[0]}{/if}
            {/if}
            {#if price}
              Launched at {price.currency}
              {price.amount?.toLocaleString('en-GB')} in {price.year} ({price.market}) — context, not
              a valuation. ARMAG holds no market-value data.
            {/if}
          </p>
        </section>

        <!-- ── Service log ───────────────────────────────────────── -->
        <section class="mt-6">
          <h3 class="type-heading text-xs uppercase tracking-widest text-ink-muted">Service log</h3>
          {#if entry.ownership.serviceLog.length > 0}
            <ul class="mt-2 flex flex-col gap-1">
              {#each entry.ownership.serviceLog as event, index (`${event.date}-${index}`)}
                <li class="type-data flex flex-wrap items-baseline gap-x-3 border-b border-line py-1 text-sm">
                  <span class="tabular-nums text-ink">{event.date}</span>
                  <span class="text-ink-secondary">{event.type.replace(/-/g, ' ')}</span>
                  {#if event.rounds !== undefined}
                    <span class="tabular-nums text-ink-muted">at {event.rounds} rds</span>
                  {/if}
                  {#if event.cost !== undefined}
                    <span class="tabular-nums text-ink-muted">{money(event.cost)}</span>
                  {/if}
                  {#if event.notes}<span class="w-full text-xs text-ink-muted">{event.notes}</span>{/if}
                  <button
                    type="button"
                    onclick={() =>
                      patchOwnership(entry.uid, {
                        serviceLog: entry.ownership!.serviceLog.filter((_, i) => i !== index),
                      })}
                    class="ml-auto text-xs text-ui-accent"
                  >
                    Remove
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="type-data mt-2 text-sm text-ink-muted">Nothing logged yet.</p>
          {/if}

          <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label class="flex min-w-0 flex-col gap-1">
              {@render field('Date')}
              <input
                type="date"
                bind:value={draftDate}
                class="type-data w-full min-w-0 rounded border border-line-strong bg-surface-0 px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label class="flex min-w-0 flex-col gap-1">
              {@render field('Type')}
              <select
                bind:value={draftType}
                class="type-data w-full min-w-0 rounded border border-line-strong bg-surface-0 px-2 py-1.5 text-sm text-ink"
              >
                {#each SERVICE_TYPES as type (type)}
                  <option value={type}>{type.replace(/-/g, ' ')}</option>
                {/each}
              </select>
            </label>
            <label class="flex min-w-0 flex-col gap-1">
              {@render field('Rounds')}
              <input
                type="number"
                min="0"
                bind:value={draftRounds}
                class="type-data w-full min-w-0 rounded border border-line-strong bg-surface-0 px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label class="flex min-w-0 flex-col gap-1">
              {@render field('Cost')}
              <input
                type="number"
                min="0"
                bind:value={draftCost}
                class="type-data w-full min-w-0 rounded border border-line-strong bg-surface-0 px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label class="flex min-w-0 flex-col gap-1">
              {@render field('Note')}
              <input
                type="text"
                bind:value={draftNotes}
                class="type-data w-full min-w-0 rounded border border-line-strong bg-surface-0 px-2 py-1.5 text-sm text-ink"
              />
            </label>
          </div>
          <button
            type="button"
            onclick={() => submitService(entry.uid)}
            class="type-data mt-3 rounded border border-line-strong bg-surface-2 px-3 py-1.5 text-sm text-ink"
          >
            Log it
          </button>
        </section>

        <!-- ── Value anchors ─────────────────────────────────────── -->
        <section class="mt-6">
          <h3 class="type-heading text-xs uppercase tracking-widest text-ink-muted">
            Your value estimates
          </h3>
          <p class="type-data mt-1 max-w-readable text-xs text-ink-muted">
            The base the condition grade multiplies. ARMAG has no market-value data and will not
            supply one — this number is yours.
          </p>
          {#if entry.ownership.valueAnchors.length > 0}
            <ul class="type-data mt-2 flex flex-wrap gap-3 text-sm">
              {#each entry.ownership.valueAnchors as anchor (anchor.date)}
                <li class="rounded-full border border-line px-2 py-0.5 text-xs">
                  <span class="tabular-nums text-ink-secondary">{anchor.date}</span>
                  <span class="tabular-nums text-ink">{money(anchor.value)}</span>
                </li>
              {/each}
            </ul>
          {/if}
          <div class="mt-3 flex flex-wrap items-end gap-3">
            <label class="flex min-w-0 flex-col gap-1">
              {@render field('Date')}
              <input
                type="date"
                bind:value={anchorDate}
                class="type-data min-w-0 rounded border border-line-strong bg-surface-0 px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label class="flex min-w-0 flex-col gap-1">
              {@render field('Value')}
              <input
                type="number"
                min="0"
                bind:value={anchorValue}
                class="type-data min-w-0 rounded border border-line-strong bg-surface-0 px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <button
              type="button"
              onclick={() => submitAnchor(entry)}
              class="type-data rounded border border-line-strong bg-surface-2 px-3 py-1.5 text-sm text-ink"
            >
              Record it
            </button>
          </div>
        </section>
      {/if}
    </div>
  {/if}

  <!-- ── Share and backup — SPEC.md §9.4 ───────────────────────────── -->
  <section class="mt-(--layout-section-gap)">
    <h2 class="type-title text-xl text-ink">Taking it with you</h2>
    <div class="mt-4 grid gap-4 lg:grid-cols-2">
      <div class="min-w-0 rounded-lg border border-line bg-surface-1 p-4">
        <h3 class="type-heading text-sm text-ink">Share link</h3>
        <p class="type-body mt-1 max-w-readable text-sm text-ink-secondary">
          Carries <strong class="text-ink">which arms are in which bays, and nothing else</strong>.
          No nicknames, no dates, no prices, no round counts, no condition grades. Safe to post.
        </p>
        <button
          type="button"
          onclick={makeShareLink}
          disabled={state.entries.length === 0}
          class="type-data mt-3 rounded border border-line-strong bg-surface-2 px-3 py-1.5 text-sm text-ink disabled:opacity-50"
        >
          Make a link
        </button>
        {#if shareUrl}
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              readonly
              value={shareUrl}
              size="1"
              class="type-data w-full min-w-0 flex-1 rounded border border-line-strong bg-surface-0 px-2 py-1.5 text-xs text-ink"
            />
            <button type="button" onclick={copyShare} class="type-data text-sm text-ui-accent">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        {/if}
      </div>

      <div class="min-w-0 rounded-lg border border-line bg-surface-1 p-4">
        <h3 class="type-heading text-sm text-ink">Full backup</h3>
        <p class="type-body mt-1 max-w-readable text-sm text-ink-secondary">
          Carries <strong class="text-ink">everything, ownership included</strong> — what you paid,
          when you bought it, how many rounds you have fired, every service you logged. It is a
          personal file. Keep it as you would keep any other.
        </p>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <a
            href={backupHref}
            download="armag-armory.json"
            class="type-data rounded border border-line-strong bg-surface-2 px-3 py-1.5 text-sm text-ink no-underline"
          >
            Download backup
          </a>
        </div>
        <label class="mt-4 flex min-w-0 flex-col gap-1">
          {@render field('Restore', 'paste a backup file here — it replaces what is on this page')}
          <textarea
            bind:value={importText}
            rows="3"
            class="type-data w-full min-w-0 rounded border border-line-strong bg-surface-0 px-2 py-1.5 text-xs text-ink"
          ></textarea>
        </label>
        <button
          type="button"
          onclick={importBackup}
          disabled={importText.trim() === ''}
          class="type-data mt-2 rounded border border-line-strong bg-surface-2 px-3 py-1.5 text-sm text-ink disabled:opacity-50"
        >
          Restore it
        </button>
      </div>
    </div>
  </section>

  {#if !ready}
    <p class="type-data mt-4 text-sm text-ink-muted">Reading what this browser remembers…</p>
  {/if}
</div>
