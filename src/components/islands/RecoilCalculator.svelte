<script lang="ts">
  /**
   * The recoil calculator — SPEC.md §9.5, over `lib/math/recoil.ts`.
   *
   * Three figures, from one conservation law: whatever leaves the muzzle, the
   * arm takes going backwards. The same functions produce the "Free recoil"
   * number on every gun page.
   *
   * ── The propellant term, and why it is optional here but never on an entry ─
   * A complete free-recoil figure includes the momentum of the propellant gas,
   * which needs a charge weight. ARMAG does not record charge weights — they
   * are handloading data, and SPEC.md §14 puts fabrication instructions outside
   * the line — so every entry's recoil figure is a stated **lower bound**. A
   * reader who has a charge weight of their own can supply it here; the tool
   * will not choose a gas velocity factor for them, because burying that choice
   * would make it invisible.
   */
  import { freeRecoilEnergy, recoilImpulse, recoilVelocity } from '../../lib/math/recoil.ts';
  import { given, type Derived } from '../../lib/math/provenance.ts';
  import { formatValue } from '../../lib/render/format.ts';

  let firearmMassKg = $state(3.9);
  let bulletMassG = $state(9.5);
  let muzzleVelocityMs = $state(840);
  let includeGas = $state(false);
  let propellantMassG = $state(2.9);
  let gasVelocityFactor = $state(1.5);

  const inputs = $derived({
    firearmMass: given(firearmMassKg > 0 ? firearmMassKg : null, 'kg', 'your figure'),
    bulletMass: given(bulletMassG > 0 ? bulletMassG : null, 'g', 'your figure'),
    muzzleVelocity: given(muzzleVelocityMs > 0 ? muzzleVelocityMs : null, 'm/s', 'your figure'),
    ...(includeGas
      ? {
          propellantMass: given(propellantMassG >= 0 ? propellantMassG : null, 'g', 'your figure'),
          gasVelocityFactor,
        }
      : {}),
  });

  const results = $derived([
    { label: 'Free recoil energy', derived: freeRecoilEnergy(inputs) },
    { label: 'Recoil velocity', derived: recoilVelocity(inputs) },
    { label: 'Recoil impulse', derived: recoilImpulse(inputs) },
  ] satisfies { label: string; derived: Derived }[]);
</script>

{#snippet units(value: number | null, unit: string)}
  {@const formatted = formatValue(value, unit)}
  {#if formatted === null}
    <span class="text-ink-muted">not calculated</span>
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

{#snippet numberField(label: string, hint: string)}
  <span class="type-data text-xs uppercase tracking-widest text-ink-muted">{label}</span>
  <span class="type-data text-[0.65rem] text-ink-muted">{hint}</span>
{/snippet}

<div class="mt-8 grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
  <form class="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface-1 p-4">
    <label class="flex flex-col gap-1">
      {@render numberField('Firearm mass', 'kilograms, as fired — loaded, not empty')}
      <input
        type="number"
        step="0.01"
        min="0.01"
        bind:value={firearmMassKg}
        class="type-data rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
      />
    </label>

    <label class="flex flex-col gap-1">
      {@render numberField('Bullet mass', 'grams')}
      <input
        type="number"
        step="0.1"
        min="0.01"
        bind:value={bulletMassG}
        class="type-data rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
      />
    </label>

    <label class="flex flex-col gap-1">
      {@render numberField('Muzzle velocity', 'metres per second')}
      <input
        type="number"
        step="1"
        min="1"
        bind:value={muzzleVelocityMs}
        class="type-data rounded border border-line-strong bg-surface-0 px-3 py-2 text-sm text-ink"
      />
    </label>

    <label class="type-data flex items-center gap-2 text-sm text-ink-secondary">
      <input type="checkbox" bind:checked={includeGas} class="accent-[var(--color-ui-accent)]" />
      Include the propellant gas term
    </label>

    {#if includeGas}
      <div class="flex flex-col gap-4 rounded border border-line-strong bg-surface-0 p-3">
        <p class="type-data text-xs text-ink-muted">
          Both figures are yours. ARMAG records no charge weights, and there is no default gas
          velocity factor here because every treatment quotes a different one.
        </p>
        <label class="flex flex-col gap-1">
          {@render numberField('Propellant charge', 'grams')}
          <input
            type="number"
            step="0.1"
            min="0"
            bind:value={propellantMassG}
            class="type-data rounded border border-line-strong bg-surface-1 px-3 py-2 text-sm text-ink"
          />
        </label>
        <label class="flex flex-col gap-1">
          {@render numberField('Gas velocity factor', 'gas exit speed ÷ muzzle velocity')}
          <input
            type="number"
            step="0.05"
            min="0"
            bind:value={gasVelocityFactor}
            class="type-data rounded border border-line-strong bg-surface-1 px-3 py-2 text-sm text-ink"
          />
        </label>
      </div>
    {/if}
  </form>

  <div class="flex min-w-0 flex-col gap-4">
    {#each results as result (result.label)}
      <div class="rounded-lg border border-line bg-surface-1 p-4">
        <h2 class="type-data text-xs uppercase tracking-wider text-ink-muted">{result.label}</h2>
        <p class="type-stat mt-1 text-stat text-ink">
          {@render units(result.derived.value, result.derived.unit)}
        </p>
        <p class="type-data mt-2 rounded bg-surface-2 px-2 py-1 text-xs text-ink-secondary">
          {result.derived.formula}
        </p>
        {#if result.derived.assumptions.length > 0}
          <ul class="type-data mt-2 flex list-disc flex-col gap-1 pl-4 text-xs text-ink-muted">
            {#each result.derived.assumptions as assumption (assumption)}
              <li>{assumption}</li>
            {/each}
          </ul>
        {/if}
      </div>
    {/each}
  </div>
</div>
