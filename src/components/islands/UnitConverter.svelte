<script lang="ts">
  /**
   * The unit converter — SPEC.md §9.5, over `lib/math/units.ts`.
   *
   * The quantity list is `IMPERIAL_FOR` itself, not a copy of it. That table is
   * what the site's own unit toggle reads, so this tool can never offer a
   * conversion the pages do not use, or use a different factor for one they
   * share — and a new SI unit added to the schema appears here on its own.
   *
   * Every constant behind it is exact by definition (the 1959 yard and pound
   * agreement, the grain as 1/7000 lb, standard gravity), so there is nothing
   * to source and nothing to round.
   */
  import { IMPERIAL_FOR } from '../../lib/math/units.ts';
  import { formatNumber } from '../../lib/render/format.ts';

  /** Units whose two systems are the same thing under two names. */
  const IDENTITY = new Set(['rpm', '']);

  const QUANTITIES = Object.entries(IMPERIAL_FOR)
    .filter(([si]) => !IDENTITY.has(si))
    .map(([si, rule]) => ({ si, imperial: rule.unit, convert: rule.convert }));

  const NAMES: Record<string, string> = {
    mm: 'Length, small',
    m: 'Length, range',
    g: 'Mass, projectile',
    kg: 'Mass, firearm',
    'm/s': 'Velocity',
    J: 'Energy',
    N: 'Force',
    MPa: 'Pressure',
    mrad: 'Angle',
  };

  let siUnit = $state('mm');
  /** Only the box the reader last typed in holds raw text; the other is computed. */
  let siRaw = $state('114');
  let imperialRaw = $state('');
  let driver = $state<'si' | 'imperial'>('si');

  const quantity = $derived(QUANTITIES.find((entry) => entry.si === siUnit) ?? QUANTITIES[0]!);

  /**
   * The inverse comes from the forward factor rather than from a second
   * constant: two independently written constants are two things that can
   * disagree, and one of them would be wrong in the fourth decimal for years.
   */
  const perSi = $derived(quantity.convert(1));

  const parse = (raw: string): number | null => {
    const value = Number(raw);
    return raw.trim() === '' || !Number.isFinite(value) ? null : value;
  };

  const show = (value: number | null): string => (value === null ? '' : formatNumber(value, 4));

  /*
   * Both fields are `value` plus `oninput`, never `bind:` — and there is no
   * effect keeping them in step. An effect that wrote one box while reading the
   * other would be reading state it also writes, which hangs the page hard
   * enough that the renderer stops answering. Deriving the passive box makes
   * the loop unrepresentable rather than merely avoided.
   */
  const siDisplay = $derived(
    driver === 'si'
      ? siRaw
      : show(parse(imperialRaw) === null ? null : parse(imperialRaw)! / perSi),
  );

  const imperialDisplay = $derived(
    driver === 'imperial'
      ? imperialRaw
      : show(parse(siRaw) === null ? null : parse(siRaw)! * perSi),
  );

</script>

<!--
  `min-w-0` on both grid children. A grid item defaults to `min-width: auto`,
  so it refuses to shrink below its content's minimum — and a `<select>`'s
  minimum is its widest option, however narrow the screen. The item stretches
  the whole page container instead, which is why the symptom showed up as the
  fixed tray being 13px too wide rather than as anything near the select.
-->
<div class="mt-8 grid gap-6 lg:grid-cols-[minmax(0,18rem)_1fr]">
  <div class="min-w-0 rounded-lg border border-line bg-surface-1 p-4">
    <!--
      `min-w-0` on the label and `w-full` on the select, both load-bearing at
      375px: a `<select>` sizes itself to its widest option, and "Length, small
      · mm ↔ in" is wider than a phone. Without them the select pushes the
      document 13px past the viewport and every full-width element on the page
      follows it — including the fixed tray, which is what makes this look like
      a layout bug somewhere else entirely.
    -->
    <label class="flex min-w-0 flex-col gap-1">
      <span class="type-data text-xs uppercase tracking-widest text-ink-muted">Quantity</span>
      <select
        bind:value={siUnit}
        class="type-data w-full rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
      >
        {#each QUANTITIES as entry (entry.si)}
          <option value={entry.si}>
            {NAMES[entry.si] ?? entry.si} · {entry.si} ↔ {entry.imperial}
          </option>
        {/each}
      </select>
    </label>

    <p class="type-data mt-4 text-xs text-ink-muted">
      1 {quantity.si || 'unit'} = <span class="tabular-nums text-ink-secondary">{formatNumber(perSi, 6)}</span>
      {quantity.imperial}
    </p>
  </div>

  <div class="grid min-w-0 gap-4 sm:grid-cols-2">
    <label class="flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-surface-1 p-4">
      <span class="type-data text-xs uppercase tracking-widest text-ink-muted">
        SI · {quantity.si}
      </span>
      <input
        type="text"
        inputmode="decimal"
        value={siDisplay}
        oninput={(event) => {
          driver = 'si';
          siRaw = event.currentTarget.value;
        }}
        size="1"
        class="type-stat w-full min-w-0 rounded border border-line-strong bg-surface-0 px-3 py-2 text-2xl tabular-nums text-ink"
      />
      <span class="type-data text-[0.65rem] text-ink-muted">
        This is what the database stores. Imperial is always computed.
      </span>
    </label>

    <label class="flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-surface-1 p-4">
      <span class="type-data text-xs uppercase tracking-widest text-ink-muted">
        Imperial · {quantity.imperial}
      </span>
      <input
        type="text"
        inputmode="decimal"
        value={imperialDisplay}
        oninput={(event) => {
          driver = 'imperial';
          imperialRaw = event.currentTarget.value;
        }}
        size="1"
        class="type-stat w-full min-w-0 rounded border border-line-strong bg-surface-0 px-3 py-2 text-2xl tabular-nums text-ink"
      />
      <span class="type-data text-[0.65rem] text-ink-muted">
        Shown to four decimal places; the factor itself is exact.
      </span>
    </label>
  </div>
</div>
