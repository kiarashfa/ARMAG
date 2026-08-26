/**
 * The standard drag functions and the atmosphere they are referenced to —
 * SPEC.md §8.1.
 *
 * The tables themselves live in `drag-tables.ts` with their provenance; this
 * module is the interpolation and the air.
 *
 * Pure. No DOM, no I/O, no framework import.
 */
import { DRAG_TABLES, type DragModel, type DragTable } from './drag-tables.ts';

export type { DragModel, DragTable };

// ---------------------------------------------------------------------------
// Atmosphere
// ---------------------------------------------------------------------------

export interface Atmosphere {
  /** kg/m³ */
  density: number;
  /** m/s */
  speedOfSound: number;
}

/** Specific gas constant for dry air, J/(kg·K). */
const R_SPECIFIC_AIR = 287.0528;
/** Ratio of specific heats for air. */
const GAMMA_AIR = 1.4;
/** ISA sea-level values. */
const ISA_TEMPERATURE_K = 288.15;
const ISA_PRESSURE_PA = 101325;
/** ISA tropospheric lapse rate, K/m. */
const ISA_LAPSE_RATE = 0.0065;
/** Exponent in the ISA pressure relation, g·M/(R·L). */
const ISA_PRESSURE_EXPONENT = 5.255877;

/**
 * The International Standard Atmosphere at a given altitude.
 *
 * Every published ballistic table states the conditions it was computed under,
 * and this is the one they almost all use: 15 °C and 1013.25 hPa at sea level,
 * dry air. Valid through the troposphere, which is well beyond any small-arms
 * shot.
 *
 * Humidity is not modelled. Its effect on density is under a third of a percent
 * across the full range from dry to saturated at sea level — smaller than the
 * lot-to-lot variation in muzzle velocity that every figure here already
 * inherits — and modelling it would imply a precision the inputs do not have.
 */
export function standardAtmosphere(altitudeM = 0): Atmosphere {
  const temperature = ISA_TEMPERATURE_K - ISA_LAPSE_RATE * altitudeM;
  const pressure =
    ISA_PRESSURE_PA * (temperature / ISA_TEMPERATURE_K) ** ISA_PRESSURE_EXPONENT;
  return {
    density: pressure / (R_SPECIFIC_AIR * temperature),
    speedOfSound: Math.sqrt(GAMMA_AIR * R_SPECIFIC_AIR * temperature),
  };
}

/** Sea-level ISA — the reference condition for every table on the site. */
export const STANDARD_ATMOSPHERE: Atmosphere = standardAtmosphere(0);

/** Atmosphere at a stated temperature and pressure, for the calculator page. */
export function atmosphereAt(temperatureC: number, pressurePa: number): Atmosphere {
  const temperature = temperatureC + 273.15;
  return {
    density: pressurePa / (R_SPECIFIC_AIR * temperature),
    speedOfSound: Math.sqrt(GAMMA_AIR * R_SPECIFIC_AIR * temperature),
  };
}

// ---------------------------------------------------------------------------
// Drag coefficient
// ---------------------------------------------------------------------------

/**
 * The drag coefficient of the standard projectile at a given Mach number.
 *
 * Linear interpolation between tabulated points. The tables are tabulated
 * finely exactly where the curve bends — every 0.01 Mach through the transonic
 * region, where drag more than doubles over a few hundredths — so a linear
 * segment is short enough that a spline would be false precision on data
 * published to four decimal places.
 *
 * **Outside the tabulated range the end value is held, not extrapolated.**
 * Below Mach 0 there is nothing to extrapolate from, and above Mach 5 no small
 * arm exists; projecting the curve past its data would be the same category of
 * mistake as the fps-per-inch rule of thumb the site refuses to use.
 */
export function dragCoefficient(model: DragModel, mach: number): number {
  return interpolateTable(DRAG_TABLES[model], mach);
}

export function interpolateTable(table: DragTable, mach: number): number {
  const first = table[0]!;
  const last = table[table.length - 1]!;
  if (mach <= first[0]) return first[1];
  if (mach >= last[0]) return last[1];

  // Binary search for the bracketing pair. The tables are ~80 rows and this is
  // called several thousand times per trajectory, so it is worth not scanning.
  let low = 0;
  let high = table.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (table[mid]![0] <= mach) low = mid;
    else high = mid;
  }

  const [m0, cd0] = table[low]!;
  const [m1, cd1] = table[high]!;
  if (m1 === m0) return cd0;
  return cd0 + ((cd1 - cd0) * (mach - m0)) / (m1 - m0);
}

/** The Mach number of a speed in a given atmosphere. */
export const machOf = (velocityMs: number, atmosphere: Atmosphere): number =>
  velocityMs / atmosphere.speedOfSound;
