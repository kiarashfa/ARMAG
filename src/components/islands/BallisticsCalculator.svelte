<script lang="ts">
  /**
   * The trajectory calculator — SPEC.md §9.5, over `lib/math/ballistics`.
   *
   * **This island contains no ballistics.** It collects six numbers, calls
   * `solveZeroAngle` and `solveTrajectory` — the same RK4 solver that renders
   * the figures on every cartridge page — and draws the result. A
   * server-rendered curve and one recomputed here cannot disagree, because they
   * are the same function (SPEC.md §2 principle 5).
   *
   * Inputs are the reader's own, so they carry no status badge and claim no
   * source. What the *model* does not include is stated on the page rather than
   * implied by a clean-looking curve: spin drift, Coriolis and aerodynamic jump
   * each need inputs this site does not record.
   */
  import { solveTrajectory, solveZeroAngle } from '../../lib/math/ballistics/trajectory.ts';
  import { formatValue } from '../../lib/render/format.ts';
  import { kineticEnergyOf } from '../../lib/math/ballistics/energy.ts';

  interface Props {
    /** Base-aware `/cartridges/`, for the "where do these numbers come from" link. */
    cartridgePrefix: string;
  }

  const { cartridgePrefix }: Props = $props();

  /* The defaults are a common 7.62×51 match load: something recognisable to
     start from, replaced the moment a reader types. */
  let dragModel = $state<'G1' | 'G7'>('G7');
  let bc = $state(0.243);
  let muzzleVelocityMs = $state(800);
  let bulletMassG = $state(11.34);
  let sightHeightMm = $state(40);
  let zeroRangeM = $state(100);
  let crossWindMs = $state(0);
  let maxRangeM = $state(600);

  const STEPS = 10;

  /** Read once on mount so a cartridge page can deep-link a load into the tool. */
  $effect(() => {
    const params = new URLSearchParams(location.search);
    const number = (key: string, apply: (value: number) => void) => {
      const raw = params.get(key);
      const parsed = raw === null ? Number.NaN : Number(raw);
      if (Number.isFinite(parsed)) apply(parsed);
    };
    if (params.get('model') === 'G1' || params.get('model') === 'G7') {
      dragModel = params.get('model') as 'G1' | 'G7';
    }
    number('bc', (v) => (bc = v));
    number('v', (v) => (muzzleVelocityMs = v));
    number('m', (v) => (bulletMassG = v));
    number('sight', (v) => (sightHeightMm = v));
    number('zero', (v) => (zeroRangeM = v));
    number('wind', (v) => (crossWindMs = v));
    number('max', (v) => (maxRangeM = v));
  });

  const valid = $derived(
    bc > 0 && muzzleVelocityMs > 0 && bulletMassG > 0 && zeroRangeM > 0 && maxRangeM >= zeroRangeM,
  );

  const solution = $derived.by(() => {
    if (!valid) return null;
    const projectile = { ballisticCoefficient: bc, dragModel, massG: bulletMassG };
    const setup = {
      muzzleVelocityMs,
      sightHeightMm,
      wind: { crossMs: crossWindMs, alongMs: 0 },
    };

    const launchAngleMrad = solveZeroAngle(projectile, setup, zeroRangeM);
    if (launchAngleMrad === null) return { launchAngleMrad: null, points: [] };

    const step = Math.max(5, Math.round(maxRangeM / STEPS / 5) * 5);
    const ranges: number[] = [];
    for (let range = 0; range <= maxRangeM; range += step) ranges.push(range);

    return {
      launchAngleMrad,
      points: solveTrajectory(projectile, { ...setup, launchAngleMrad }, { atRangesM: ranges }),
    };
  });

  const muzzleEnergyJ = $derived(
    bulletMassG > 0 && muzzleVelocityMs > 0 ? kineticEnergyOf(bulletMassG, muzzleVelocityMs) : null,
  );

  /** The drop curve, in a viewBox of range × centimetres of drop. */
  const curve = $derived.by(() => {
    const points = solution?.points ?? [];
    if (points.length < 2) return null;
    const maxRange = points[points.length - 1]!.rangeM;
    const drops = points.map((point) => point.dropM * 100);
    const low = Math.min(...drops, 0);
    const high = Math.max(...drops, 0);
    const span = Math.max(high - low, 1);
    const path = points
      .map((point, index) => {
        const x = (point.rangeM / maxRange) * 100;
        const y = ((high - point.dropM * 100) / span) * 100;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
    // Where the line of sight sits inside the same box, so the crossing points
    // are visible rather than having to be read off the table.
    const sightY = ((high - 0) / span) * 100;
    return { path, sightY, maxRange, low, high };
  });

  const fmt = (value: number | null, unit: string) => formatValue(value, unit);
</script>

{#snippet units(value: number | null, unit: string)}
  {@const formatted = fmt(value, unit)}
  {#if formatted === null}
    <span class="text-ink-muted">—</span>
  {:else if formatted.identical}
    <span class="tabular-nums">{formatted.metric}</span>
  {:else}
    <span class="tabular-nums"
      ><span class="u-metric">{formatted.metric}</span><span class="u-imperial" data-pagefind-ignore
        >{formatted.imperial}</span
      ></span
    >
  {/if}
{/snippet}

{#snippet field(label: string, hint: string)}
  <span class="type-data text-xs uppercase tracking-widest text-ink-muted">{label}</span>
  <span class="type-data text-[0.65rem] text-ink-muted">{hint}</span>
{/snippet}

<div class="mt-8 grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
  <form class="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface-1 p-4">
    <label class="flex flex-col gap-1">
      {@render field('Drag model', 'G7 for a boat-tail rifle bullet, G1 for most published data')}
      <select
        bind:value={dragModel}
        class="type-data rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
      >
        <option value="G7">G7</option>
        <option value="G1">G1</option>
      </select>
    </label>

    <label class="flex flex-col gap-1">
      {@render field('Ballistic coefficient', `lb/in², for ${dragModel}`)}
      <input
        type="number"
        step="0.001"
        min="0.001"
        bind:value={bc}
        class="type-data rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
      />
    </label>

    <label class="flex flex-col gap-1">
      {@render field('Muzzle velocity', 'metres per second')}
      <input
        type="number"
        step="1"
        min="1"
        bind:value={muzzleVelocityMs}
        class="type-data rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
      />
    </label>

    <label class="flex flex-col gap-1">
      {@render field('Bullet mass', 'grams')}
      <input
        type="number"
        step="0.01"
        min="0.01"
        bind:value={bulletMassG}
        class="type-data rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
      />
    </label>

    <label class="flex flex-col gap-1">
      {@render field('Sight height over bore', 'millimetres')}
      <input
        type="number"
        step="1"
        min="0"
        bind:value={sightHeightMm}
        class="type-data rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
      />
    </label>

    <label class="flex flex-col gap-1">
      {@render field('Zero range', 'metres')}
      <input
        type="number"
        step="5"
        min="5"
        bind:value={zeroRangeM}
        class="type-data rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
      />
    </label>

    <label class="flex flex-col gap-1">
      {@render field('Crosswind', 'metres per second, positive from the left')}
      <input
        type="number"
        step="0.5"
        bind:value={crossWindMs}
        class="type-data rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
      />
    </label>

    <label class="flex flex-col gap-1">
      {@render field('Solve to', 'metres')}
      <input
        type="number"
        step="50"
        min="10"
        bind:value={maxRangeM}
        class="type-data rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
      />
    </label>
  </form>

  <div class="min-w-0">
    {#if !valid}
      <p class="type-data rounded-lg border border-dashed border-line-strong bg-surface-1 p-6 text-sm text-ink-muted">
        Every figure has to be positive, and the solve range cannot be shorter than the zero.
      </p>
    {:else if solution?.launchAngleMrad === null}
      <p class="type-data rounded-lg border border-line bg-surface-1 p-6 text-sm text-status-conflicting">
        No barrel elevation puts this bullet on the line of sight at {zeroRangeM} m. That is a real
        answer, not an error — the solver returns nothing rather than a projection.
      </p>
    {:else}
      <div class="grid gap-4 rounded-lg border border-line bg-surface-1 p-4 sm:grid-cols-3">
        <div class="flex flex-col">
          <span class="type-data text-xs uppercase tracking-wider text-ink-muted">Muzzle energy</span>
          <span class="type-stat text-2xl text-ink">{@render units(muzzleEnergyJ, 'J')}</span>
        </div>
        <div class="flex flex-col">
          <span class="type-data text-xs uppercase tracking-wider text-ink-muted">Elevation</span>
          <span class="type-stat text-2xl text-ink">
            {@render units(solution?.launchAngleMrad ?? null, 'mrad')}
          </span>
        </div>
        <div class="flex flex-col">
          <span class="type-data text-xs uppercase tracking-wider text-ink-muted">Zeroed at</span>
          <span class="type-stat text-2xl text-ink">{@render units(zeroRangeM, 'm')}</span>
        </div>
      </div>

      {#if curve}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          class="mt-4 h-48 w-full rounded-lg border border-line bg-surface-1"
          role="img"
          aria-label={`Trajectory to ${curve.maxRange} metres, dropping from ${curve.high.toFixed(1)} to ${curve.low.toFixed(1)} centimetres relative to the line of sight`}
        >
          <line
            x1="0"
            x2="100"
            y1={curve.sightY}
            y2={curve.sightY}
            class="stroke-line-strong"
            stroke-width="0.4"
            stroke-dasharray="2 2"
            vector-effect="non-scaling-stroke"
          />
          <path
            d={curve.path}
            class="fill-none stroke-ui-accent"
            stroke-width="1.5"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <p class="type-data mt-1 text-xs text-ink-muted">
          Path relative to the line of sight (dashed), 0 to {curve.maxRange} m. The vertical scale is
          stretched to fill the box; read the table for the figures.
        </p>
      {/if}

      <div class="mt-4 overflow-x-auto">
        <table class="type-data w-full min-w-[34rem] text-sm">
          <thead>
            <tr class="border-b border-line-strong text-left text-ink-muted">
              <th scope="col" class="p-2">Range</th>
              <th scope="col" class="p-2 text-right">Drop</th>
              <th scope="col" class="p-2 text-right">Wind</th>
              <th scope="col" class="p-2 text-right">Velocity</th>
              <th scope="col" class="p-2 text-right">Energy</th>
              <th scope="col" class="p-2 text-right">Time</th>
              <th scope="col" class="p-2 text-right">Mach</th>
            </tr>
          </thead>
          <tbody>
            {#each solution?.points ?? [] as point (point.rangeM)}
              <tr class="border-b border-line">
                <th scope="row" class="p-2 text-left font-normal text-ink">
                  {@render units(point.rangeM, 'm')}
                </th>
                <td class="p-2 text-right text-ink-secondary">
                  {@render units(point.dropM * 1000, 'mm')}
                </td>
                <td class="p-2 text-right text-ink-secondary">
                  {@render units(point.windageM * 1000, 'mm')}
                </td>
                <td class="p-2 text-right text-ink-secondary">
                  {@render units(point.velocityMs, 'm/s')}
                </td>
                <td class="p-2 text-right text-ink-secondary">
                  {@render units(point.energyJ ?? null, 'J')}
                </td>
                <td class="p-2 text-right text-ink-secondary tabular-nums">
                  {point.timeS.toFixed(3)} s
                </td>
                <td class="p-2 text-right text-ink-secondary tabular-nums">
                  {point.mach.toFixed(2)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <p class="type-data mt-3 max-w-note text-xs text-ink-muted">
        These are your numbers, not ours: nothing here is sourced, so nothing carries a status
        badge. For figures that are,
        <a href={cartridgePrefix} class="text-ui-accent">open a cartridge</a> — its loads carry
        sourced velocities per barrel length, which is where a real muzzle velocity comes from.
      </p>
    {/if}
  </div>
</div>
