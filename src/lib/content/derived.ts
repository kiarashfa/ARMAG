/**
 * Turns a joined entry into the figures a gun page renders.
 *
 * This is the seam between the content model and the math engine, and it is the
 * only place that knows about both. `lib/math` stays free of the schema;
 * templates stay free of the arithmetic; and because the route and the dev
 * render harness both come through here, the two cannot drift.
 *
 * Every figure returned is a `Derived`, so it arrives at the template already
 * carrying its status, its input chain and its formula. A template never
 * decides how confident to look.
 */
import type { CartridgeData, CartridgeLoad } from '../../schemas/cartridge.ts';
import type { GunData } from '../../schemas/gun.ts';
import type { PropertyValue } from '../../schemas/primitives.ts';
import { kineticEnergy, momentum, powerFactor, sectionalDensity } from '../math/ballistics/energy.ts';
import { velocityForBarrel } from '../math/ballistics/velocity.ts';
import { magazineDumpTime, sightingErrorAngle } from '../math/handling.ts';
import { loadedMass } from '../math/mass.ts';
import { freeRecoilEnergy } from '../math/recoil.ts';
import type { Derived, ValueLike } from '../math/provenance.ts';

export interface DerivedFigure {
  label: string;
  derived: Derived;
}

/** A field that is simply absent reads as a placeholder, which blocks cleanly. */
const orMissing = (value: PropertyValue | undefined | null, unit: string): ValueLike =>
  value ?? { value: null, unit, status: 'placeholder' };

/** The load a page should compute from: the first one with a bullet mass. */
export const primaryLoad = (cartridge?: CartridgeData | null): CartridgeLoad | null =>
  cartridge?.loads.find((load) => load.bulletMass.value !== null) ?? null;

export interface GunFigures {
  /** The five-number strip, in the order SPEC.md §11 gives it. */
  statStrip: DerivedFigure[];
  /** Everything else, for the derived-metrics panel above the spec table. */
  metrics: DerivedFigure[];
  /** Present when the muzzle velocity had to be interpolated or substituted. */
  velocityCaveat?: string;
}

/**
 * Every derived figure for one entry.
 *
 * Figures whose inputs are missing are **not filtered out**. They come back
 * blocked, naming the input that is missing, so the page can say "not recorded
 * because we have no cartridge mass" rather than quietly omitting the row —
 * SPEC.md §2 principle 6.
 */
export function figuresForGun(gun: GunData, cartridge?: CartridgeData | null): GunFigures {
  const load = primaryLoad(cartridge);
  const chambering = gun.chamberings.find((c) => c.primary) ?? gun.chamberings[0];
  const barrelLength = chambering?.barrelLength ?? gun.barrelLength;

  // Muzzle velocity is the one figure the whole derived layer hangs off, and
  // the one nobody publishes for this pairing. SPEC.md §8.2: interpolate
  // between sourced points, never project past them.
  const velocityResult = load
    ? velocityForBarrel(load.velocityByBarrel, barrelLength?.value ?? Number.NaN)
    : null;
  const muzzleVelocity: ValueLike =
    velocityResult && velocityResult.velocity.value !== null
      ? {
          value: velocityResult.velocity.value,
          unit: 'm/s',
          status: velocityResult.velocity.status,
          sourceNote: velocityResult.caveat,
        }
      : { value: null, unit: 'm/s', status: 'placeholder' };

  const bulletMass = orMissing(load?.bulletMass, 'g');
  const capacity = orMissing(chambering?.capacity, '');

  const energy = kineticEnergy(bulletMass, muzzleVelocity);
  const loaded = loadedMass({
    massEmpty: orMissing(gun.massEmpty, 'kg'),
    massMagazineEmpty: orMissing(gun.massMagazineEmpty, 'kg'),
    cartridgeMass: orMissing(load?.cartridgeMass, 'g'),
    capacity,
  });

  // Recoil wants the mass of the arm as fired, and falls back to the empty
  // mass when the loaded figure is blocked — stated in the assumption line
  // rather than silently.
  const firearmMass: ValueLike =
    loaded.value !== null
      ? { value: loaded.value, unit: 'kg', status: loaded.status, sourceNote: 'loaded mass' }
      : orMissing(gun.massEmpty, 'kg');

  const statStrip: DerivedFigure[] = [
    { label: 'Muzzle energy', derived: energy },
    {
      label: 'Muzzle velocity',
      derived: {
        value: muzzleVelocity.value,
        status: muzzleVelocity.status,
        unit: 'm/s',
        formula: velocityResult?.velocity.formula ?? 'no sourced velocity for this pairing',
        inputs: velocityResult?.velocity.inputs ?? [],
        assumptions: velocityResult?.velocity.assumptions ?? [],
        blockedBy: muzzleVelocity.value === null ? 'muzzle velocity' : undefined,
      },
    },
    { label: 'Loaded mass', derived: loaded },
    {
      label: 'Free recoil',
      derived: freeRecoilEnergy({ firearmMass, bulletMass, muzzleVelocity }),
    },
    { label: 'Capacity', derived: capacityFigure(capacity) },
  ];

  const metrics: DerivedFigure[] = [
    { label: 'Momentum', derived: momentum(bulletMass, muzzleVelocity) },
    {
      label: 'Sectional density',
      derived: sectionalDensity(bulletMass, orMissing(cartridge?.bulletDiameter, 'mm')),
    },
    { label: 'Power factor', derived: powerFactor(bulletMass, muzzleVelocity) },
    {
      label: 'Magazine dump',
      derived: magazineDumpTime(capacity, orMissing(gun.cyclicRate, 'rpm')),
    },
    {
      label: 'Sight error at 1 mm',
      derived: sightingErrorAngle(orMissing(gun.sightRadius, 'mm'), 1),
    },
  ];

  return { statStrip, metrics, velocityCaveat: velocityResult?.caveat };
}

/** Capacity is sourced, not derived, but the strip renders one shape. */
function capacityFigure(capacity: ValueLike): Derived {
  return {
    value: capacity.value,
    status: capacity.status,
    unit: '',
    formula: 'as published for the primary chambering',
    inputs: [
      {
        label: 'capacity',
        value: capacity.value,
        unit: '',
        status: capacity.status,
        source: capacity.source,
        sourceUrl: capacity.sourceUrl,
        sourceNote: capacity.sourceNote,
      },
    ],
    assumptions: [],
    blockedBy: capacity.value === null ? 'capacity' : undefined,
  };
}
