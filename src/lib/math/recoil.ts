/**
 * Free recoil — SPEC.md §8.1, and the input to the Matchmaker's recoil
 * tolerance (§9.3), which is the one filter nobody else offers.
 *
 * ── The honest gap, stated up front ────────────────────────────────────────
 * The textbook free-recoil formula has three ejecta terms: the bullet, the
 * propellant gas, and the wad in a shotshell. **ARMAG does not record powder
 * charge weights** — they are handloading data and SPEC.md §14 puts fabrication
 * instructions outside the editorial line — so the gas term cannot be computed
 * from stored data.
 *
 * The answer is not to invent a charge weight, and it is not to skip recoil.
 * It is to compute what the data supports, and to say what is missing:
 * `propellantMassG` is an optional argument, and when it is absent the result
 * is a **lower bound**, marked `estimated`, carrying an assumption line that
 * says so. A reader comparing two rifles gets a comparison that is consistent
 * and honest rather than one that is complete and invented.
 *
 * The gas velocity factor is likewise never defaulted. Every published
 * treatment uses a different one, so a caller that wants the gas term must
 * supply both numbers and own them — the same discipline as the fps-per-inch
 * rule in `ballistics/velocity.ts`.
 *
 * Pure. No DOM, no I/O, no framework import.
 */
import { derive, given, type Derived, type ValueLike } from './provenance.ts';

export interface RecoilInputs {
  /** Mass of the arm as it is fired, kg. Loaded mass, not empty. */
  firearmMass: ValueLike;
  bulletMass: ValueLike;
  muzzleVelocity: ValueLike;
  /**
   * Propellant charge, grams. Omitted for every entry on this site, because
   * charge weights are not recorded. Present only for a caller that has one —
   * the calculator page, where the reader typed it.
   */
  propellantMass?: ValueLike;
  /**
   * Ratio of mean propellant gas exit velocity to muzzle velocity. Required
   * when `propellantMass` is given; there is no default, because every source
   * quotes a different one and burying a choice here would make it invisible.
   */
  gasVelocityFactor?: number;
}

const LOWER_BOUND_NOTE =
  'Propellant gas momentum is excluded: ARMAG does not record charge weights (SPEC.md §14). This is therefore a lower bound on the real free recoil, consistent between entries but smaller than a figure that includes the gas term.';

/**
 * Momentum carried out of the muzzle — the quantity the arm must absorb.
 *
 * Conservation of momentum is the whole of the physics here: whatever leaves
 * the front, the arm takes going backwards.
 */
export function ejectaMomentum(inputs: RecoilInputs): Derived {
  const hasGas = inputs.propellantMass !== undefined && inputs.gasVelocityFactor !== undefined;

  return derive({
    formula: hasGas
      ? 'p = m_bullet · v + m_propellant · (k · v)'
      : 'p = m_bullet · v',
    unit: 'kg·m/s',
    modelStatus: hasGas ? undefined : 'estimated',
    inputs: [
      { label: 'm_bullet', of: inputs.bulletMass, unit: 'g' },
      { label: 'v', of: inputs.muzzleVelocity, unit: 'm/s' },
      ...(hasGas
        ? [
            { label: 'm_propellant', of: inputs.propellantMass!, unit: 'g' },
            { label: 'k', of: given(inputs.gasVelocityFactor!, ''), unit: '' },
          ]
        : []),
    ],
    assumptions: hasGas
      ? ['Propellant gas is treated as leaving at k times the muzzle velocity, with k supplied by the caller.']
      : [LOWER_BOUND_NOTE],
    compute: (values) => {
      const [bulletG, velocity] = values as [number, number];
      let momentum = (bulletG / 1000) * velocity;
      if (hasGas) {
        const [, , propellantG, k] = values as [number, number, number, number];
        momentum += (propellantG / 1000) * (k * velocity);
      }
      return momentum;
    },
  });
}

/** How fast the arm starts moving backwards, m/s. */
export function recoilVelocity(inputs: RecoilInputs): Derived {
  const momentum = ejectaMomentum(inputs);
  return derive({
    formula: 'v_recoil = p_ejecta / m_firearm',
    unit: 'm/s',
    modelStatus: momentum.status,
    inputs: [
      { label: 'p_ejecta', of: { value: momentum.value, status: momentum.status, unit: 'kg·m/s' } },
      { label: 'm_firearm', of: inputs.firearmMass, unit: 'kg' },
    ],
    assumptions: momentum.assumptions,
    compute: ([p, mass]) => (mass! === 0 ? 0 : p! / mass!),
  });
}

/**
 * Free recoil energy, J — the number the recoil ladder ranks on.
 *
 * "Free" means the arm is treated as unrestrained: nothing about a shoulder, a
 * stance, a recoil pad or a muzzle brake is modelled, because none of those is
 * a property of the arm and all of them vary by shooter. It is a consistent
 * physical comparison, not a prediction of what the recoil will feel like.
 */
export function freeRecoilEnergy(inputs: RecoilInputs): Derived {
  const velocity = recoilVelocity(inputs);
  return derive({
    formula: 'E_recoil = ½ · m_firearm · v_recoil²',
    unit: 'J',
    modelStatus: velocity.status,
    inputs: [
      { label: 'm_firearm', of: inputs.firearmMass, unit: 'kg' },
      { label: 'v_recoil', of: { value: velocity.value, status: velocity.status, unit: 'm/s' } },
    ],
    assumptions: [
      ...velocity.assumptions,
      'Free recoil: the arm is unrestrained. Stock design, muzzle devices, stance and shooter mass are not modelled, because none of them is a property of the arm.',
    ],
    compute: ([mass, v]) => 0.5 * mass! * v! * v!,
  });
}

/**
 * Recoil impulse, N·s — the same momentum, named the way shooters name it.
 *
 * Worth reporting alongside energy because the two rank differently: a heavy
 * slow-moving arm and a light fast one can share an impulse and differ a lot in
 * energy, and readers disagree about which matters. The site declines to pick.
 */
export const recoilImpulse = (inputs: RecoilInputs): Derived => {
  const momentum = ejectaMomentum(inputs);
  return { ...momentum, unit: 'N·s', formula: `${momentum.formula}  (impulse = momentum)` };
};
