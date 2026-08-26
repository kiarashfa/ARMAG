/**
 * Handling figures — SPEC.md §8.1.
 *
 * ── One thing SPEC.md asks for that is not here ────────────────────────────
 * §8.1 lists "sight radius from dimensions". Sight radius cannot be derived
 * from overall length: where the sights sit on a barrel is a design choice, not
 * a proportion, and a slide-mounted rear sight and a receiver-mounted one on
 * the same pistol differ by inches. Deriving it would produce a number that
 * looked measured and was not — the exact failure mode Instruction.md §0 rule 2
 * exists to stop. Sight radius is a **stored, sourced field** on the gun schema
 * instead, and what this module supplies is the geometry that uses it: how much
 * a given sight misalignment costs downrange.
 *
 * Everything else here is arithmetic over cyclic rate and capacity, which are
 * both sourced.
 *
 * Pure. No DOM, no I/O, no framework import.
 */
import { derive, type Derived, type ValueLike } from './provenance.ts';
import { radiansToMrad } from './units.ts';

/**
 * The angular error produced by a given misalignment of the sights.
 *
 * This is what a long sight radius actually buys, and it is the honest way to
 * compare two sets of iron sights: a 1 mm error on a 100 mm radius is five
 * times the angle it is on a 500 mm one. Reported in milliradians, so it can be
 * turned into a distance at any range by `subtendAtRange`.
 */
export function sightingErrorAngle(sightRadius: ValueLike, misalignmentMm: number): Derived {
  return derive({
    formula: 'θ = atan(misalignment / sight radius)',
    unit: 'mrad',
    inputs: [
      { label: 'sight radius', of: sightRadius, unit: 'mm' },
      { label: 'misalignment', of: { value: misalignmentMm, status: 'verified', unit: 'mm' } },
    ],
    assumptions: [
      'Shows what a stated aiming error costs. The misalignment is the reader’s figure; the site does not claim how well anyone aims.',
    ],
    compute: ([radius, misalignment]) =>
      radius! === 0 ? 0 : radiansToMrad(Math.atan(misalignment! / radius!)),
  });
}

/**
 * Time to empty a full magazine at the cyclic rate.
 *
 * `capacity - 1` intervals, not `capacity`: the first round leaves at t = 0.
 * Off by one round it would be a 6% error on a 17-round magazine, which is the
 * kind of small wrongness that survives review for years.
 */
export function magazineDumpTime(capacity: ValueLike, cyclicRate: ValueLike): Derived {
  return derive({
    formula: 't = (n − 1) / (rpm / 60)',
    unit: 's',
    inputs: [
      { label: 'n', of: capacity, unit: '' },
      { label: 'rpm', of: cyclicRate, unit: 'rpm' },
    ],
    assumptions: [
      'Cyclic rate held for the whole magazine, no stoppages, trigger held down. A theoretical figure for comparing mechanisms, not a measured one.',
    ],
    compute: ([n, rpm]) => (rpm! === 0 || n! <= 1 ? 0 : ((n! - 1) / rpm!) * 60),
  });
}

/** Time for a fixed-length burst — the two- and three-round trigger groups. */
export function burstTime(rounds: number, cyclicRate: ValueLike): Derived {
  return derive({
    formula: 't = (rounds − 1) / (rpm / 60)',
    unit: 's',
    inputs: [
      { label: 'rounds', of: { value: rounds, status: 'verified', unit: '' } },
      { label: 'rpm', of: cyclicRate, unit: 'rpm' },
    ],
    compute: ([n, rpm]) => (rpm! === 0 || n! <= 1 ? 0 : ((n! - 1) / rpm!) * 60),
  });
}

/** The interval between two consecutive shots at the cyclic rate. */
export function shotInterval(cyclicRate: ValueLike): Derived {
  return derive({
    formula: 't = 60 / rpm',
    unit: 's',
    inputs: [{ label: 'rpm', of: cyclicRate, unit: 'rpm' }],
    compute: ([rpm]) => (rpm! === 0 ? 0 : 60 / rpm!),
  });
}

/**
 * How many magazine changes a given number of rounds costs.
 *
 * Ceiling, because a partial magazine is still a magazine — the arithmetic
 * everyone does in their head and gets wrong at the boundary.
 */
export function magazinesFor(rounds: number, capacity: ValueLike): Derived {
  return derive({
    formula: '⌈rounds / capacity⌉',
    unit: '',
    inputs: [
      { label: 'rounds', of: { value: rounds, status: 'verified', unit: '' } },
      { label: 'capacity', of: capacity, unit: '' },
    ],
    compute: ([total, capacity_]) => (capacity_! === 0 ? 0 : Math.ceil(total! / capacity_!)),
  });
}
