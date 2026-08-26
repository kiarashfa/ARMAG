/**
 * Loaded mass — SPEC.md §8.1.
 *
 * "Almost nobody publishes this", and that is exactly why it is worth
 * computing: every spec sheet in the world prints the empty weight, and nobody
 * carries an empty gun. A loaded Glock 17 is about 15% heavier than the figure
 * on its own datasheet.
 *
 * The arithmetic is trivial. The value is entirely in the provenance: three
 * sourced masses in, one honest total out, and a blank rather than a guess when
 * the cartridge mass is missing — which it often will be, because manufacturers
 * publish bullet weight and almost never loaded cartridge weight.
 *
 * Pure. No DOM, no I/O, no framework import.
 */
import { derive, given, type Derived, type ValueLike } from './provenance.ts';

export interface LoadedMassInputs {
  /** Mass of the arm with an empty magazine removed, kg. */
  massEmpty: ValueLike;
  /** Mass of the empty magazine, kg. */
  massMagazineEmpty: ValueLike;
  /**
   * Mass of ONE loaded cartridge, grams. Not the bullet: a loaded 9×19 round
   * weighs roughly twice its bullet, and using the bullet mass here would
   * understate the total by more than the magazine contributes.
   */
  cartridgeMass: ValueLike;
  /** Rounds carried, dimensionless. */
  capacity: ValueLike;
}

/**
 * Mass of the arm as it is actually carried: empty + magazine + n cartridges.
 *
 * Every input must be present. There is no partial answer here — a "loaded
 * mass" missing the ammunition is just the empty mass wearing a better name.
 */
export function loadedMass(inputs: LoadedMassInputs): Derived {
  return derive({
    formula: 'm_loaded = m_empty + m_magazine + n · m_cartridge',
    unit: 'kg',
    inputs: [
      { label: 'm_empty', of: inputs.massEmpty, unit: 'kg' },
      { label: 'm_magazine', of: inputs.massMagazineEmpty, unit: 'kg' },
      { label: 'n', of: inputs.capacity, unit: '' },
      { label: 'm_cartridge', of: inputs.cartridgeMass, unit: 'g' },
    ],
    assumptions: [
      'One magazine, filled to the stated capacity. Spare magazines, optics, slings and lights are the owner’s, not the arm’s.',
    ],
    compute: ([empty, magazine, capacity, cartridgeG]) =>
      empty! + magazine! + (capacity! * cartridgeG!) / 1000,
  });
}

/** Mass of a full magazine on its own — what a spare actually costs to carry. */
export function loadedMagazineMass(
  massMagazineEmpty: ValueLike,
  capacity: ValueLike,
  cartridgeMass: ValueLike,
): Derived {
  return derive({
    formula: 'm_magazine_loaded = m_magazine + n · m_cartridge',
    unit: 'kg',
    inputs: [
      { label: 'm_magazine', of: massMagazineEmpty, unit: 'kg' },
      { label: 'n', of: capacity, unit: '' },
      { label: 'm_cartridge', of: cartridgeMass, unit: 'g' },
    ],
    compute: ([magazine, capacity_, cartridgeG]) => magazine! + (capacity_! * cartridgeG!) / 1000,
  });
}

/**
 * The fraction of carried mass that is ammunition.
 *
 * A genuinely different way to compare a belt-fed machine gun with a carbine,
 * and one that falls straight out of numbers already on the page.
 */
export function ammunitionFraction(inputs: LoadedMassInputs): Derived {
  const total = loadedMass(inputs);
  return derive({
    formula: 'n · m_cartridge / m_loaded',
    unit: '',
    inputs: [
      { label: 'n', of: inputs.capacity, unit: '' },
      { label: 'm_cartridge', of: inputs.cartridgeMass, unit: 'g' },
      { label: 'm_loaded', of: { value: total.value, status: total.status, unit: 'kg' } },
    ],
    compute: ([capacity, cartridgeG, loaded]) =>
      loaded! === 0 ? 0 : (capacity! * cartridgeG!) / 1000 / loaded!,
  });
}

/** Convenience for a caller holding plain numbers, e.g. the size calculator. */
export const loadedMassOf = (
  massEmptyKg: number,
  massMagazineKg: number,
  cartridgeMassG: number,
  capacity: number,
): number =>
  loadedMass({
    massEmpty: given(massEmptyKg, 'kg'),
    massMagazineEmpty: given(massMagazineKg, 'kg'),
    cartridgeMass: given(cartridgeMassG, 'g'),
    capacity: given(capacity, ''),
  }).value as number;
