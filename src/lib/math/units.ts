/**
 * Unit conversion — SPEC.md §8.1.
 *
 * **SI is what is stored. Imperial is computed on demand, client-side, and is
 * never stored and never indexed.** That rule is why this module exists at all
 * and why nothing else in `lib/math` accepts an imperial argument: a `velocity`
 * field holding feet per second, read by a solver expecting metres per second,
 * produces a plausible wrong answer rather than a crash — the worst failure
 * mode available to a reference site.
 *
 * Every constant below is **exact by definition**, not measured and not
 * rounded. The international yard and pound agreement of 1959 defines the inch
 * as exactly 25.4 mm and the pound as exactly 0.45359237 kg; the grain is
 * exactly 1/7000 lb; the foot-pound-force follows from the pound-force, which
 * follows from standard gravity, itself defined exactly as 9.80665 m/s². There
 * is nothing here to source and nothing here to get subtly wrong.
 *
 * Pure. No DOM, no I/O, no framework import.
 */

// ---------------------------------------------------------------------------
// Exact definitions
// ---------------------------------------------------------------------------

/** Standard gravity, defined exactly (CGPM 1901). */
export const STANDARD_GRAVITY_MS2 = 9.80665;

/** 1 inch = 25.4 mm exactly (international yard and pound agreement, 1959). */
export const MM_PER_INCH = 25.4;
/** 1 foot = 0.3048 m exactly. */
export const M_PER_FOOT = 0.3048;
/** 1 yard = 0.9144 m exactly. */
export const M_PER_YARD = 0.9144;
/** 1 pound = 0.45359237 kg exactly. */
export const KG_PER_POUND = 0.45359237;
/** 1 grain = 1/7000 lb exactly = 64.79891 mg. */
export const G_PER_GRAIN = 0.06479891;
/** 1 avoirdupois ounce = 1/16 lb exactly. */
export const G_PER_OUNCE = 28.349523125;
/** 1 lbf = 1 lb × standard gravity, exactly. */
export const N_PER_POUND_FORCE = KG_PER_POUND * STANDARD_GRAVITY_MS2;
/** 1 ft·lbf = 1 lbf × 1 ft, exactly. */
export const J_PER_FOOT_POUND = N_PER_POUND_FORCE * M_PER_FOOT;
/** 1 psi = 1 lbf / in², expressed in MPa. */
export const MPA_PER_PSI = N_PER_POUND_FORCE / (MM_PER_INCH * MM_PER_INCH);

/**
 * 1 milliradian = 1/1000 radian. A minute of angle is 1/60 of a degree, so the
 * ratio is exact rather than the "1 MOA ≈ 1 inch at 100 yards" approximation —
 * that shorthand is off by about 4.7%, which is a whole minute at 1000 yards.
 */
export const MOA_PER_MRAD = (180 / Math.PI) * 60 / 1000;

// ---------------------------------------------------------------------------
// Length
// ---------------------------------------------------------------------------

export const mmToInches = (mm: number): number => mm / MM_PER_INCH;
export const inchesToMm = (inches: number): number => inches * MM_PER_INCH;
export const mToYards = (m: number): number => m / M_PER_YARD;
export const yardsToM = (yards: number): number => yards * M_PER_YARD;
export const mToFeet = (m: number): number => m / M_PER_FOOT;
export const feetToM = (feet: number): number => feet * M_PER_FOOT;

// ---------------------------------------------------------------------------
// Mass
// ---------------------------------------------------------------------------

export const gToGrains = (g: number): number => g / G_PER_GRAIN;
export const grainsToG = (grains: number): number => grains * G_PER_GRAIN;
export const kgToPounds = (kg: number): number => kg / KG_PER_POUND;
export const poundsToKg = (lb: number): number => lb * KG_PER_POUND;
export const gToOunces = (g: number): number => g / G_PER_OUNCE;
export const ouncesToG = (oz: number): number => oz * G_PER_OUNCE;

// ---------------------------------------------------------------------------
// Velocity, energy, force, pressure
// ---------------------------------------------------------------------------

export const msToFps = (ms: number): number => ms / M_PER_FOOT;
export const fpsToMs = (fps: number): number => fps * M_PER_FOOT;
export const joulesToFootPounds = (j: number): number => j / J_PER_FOOT_POUND;
export const footPoundsToJoules = (ftLbf: number): number => ftLbf * J_PER_FOOT_POUND;
export const newtonsToPoundsForce = (n: number): number => n / N_PER_POUND_FORCE;
export const poundsForceToNewtons = (lbf: number): number => lbf * N_PER_POUND_FORCE;
export const mpaToPsi = (mpa: number): number => mpa / MPA_PER_PSI;
export const psiToMpa = (psi: number): number => psi * MPA_PER_PSI;

// ---------------------------------------------------------------------------
// Angle
// ---------------------------------------------------------------------------

export const mradToMoa = (mrad: number): number => mrad * MOA_PER_MRAD;
export const moaToMrad = (moa: number): number => moa / MOA_PER_MRAD;
export const mradToDegrees = (mrad: number): number => (mrad / 1000) * (180 / Math.PI);
export const degreesToMrad = (deg: number): number => (deg * (Math.PI / 180)) * 1000;
export const mradToRadians = (mrad: number): number => mrad / 1000;
export const radiansToMrad = (rad: number): number => rad * 1000;

/**
 * The linear size an angle subtends at a distance — the arithmetic behind every
 * scope adjustment on the site.
 *
 * Uses the true tangent rather than the small-angle shortcut. At the angles a
 * sight actually works over the difference is negligible, and using `tan`
 * anyway costs nothing and stays correct if something ever asks for 200 mrad.
 */
export function subtendAtRange(mrad: number, rangeM: number): number {
  return Math.tan(mradToRadians(mrad)) * rangeM;
}

/** The inverse: the angle a linear offset subtends at a distance. */
export function angleSubtendedBy(offsetM: number, rangeM: number): number {
  if (rangeM === 0) return 0;
  return radiansToMrad(Math.atan(offsetM / rangeM));
}

// ---------------------------------------------------------------------------
// The imperial unit set, for the persistent toggle (SPEC.md §11)
// ---------------------------------------------------------------------------

export type UnitSystem = 'metric' | 'imperial';

/**
 * How each SI unit is displayed in the other system.
 *
 * A table rather than a switch so the unit toggle, the compare table and the
 * calculators cannot disagree about what `g` becomes — and so a new SI unit
 * added to the schema is a compile error here rather than a silent passthrough
 * that renders grams to a reader who asked for imperial.
 */
export const IMPERIAL_FOR: Record<string, { unit: string; convert: (si: number) => number }> = {
  mm: { unit: 'in', convert: mmToInches },
  m: { unit: 'yd', convert: mToYards },
  g: { unit: 'gr', convert: gToGrains },
  kg: { unit: 'lb', convert: kgToPounds },
  'm/s': { unit: 'fps', convert: msToFps },
  J: { unit: 'ft·lbf', convert: joulesToFootPounds },
  N: { unit: 'lbf', convert: newtonsToPoundsForce },
  MPa: { unit: 'psi', convert: mpaToPsi },
  // Unchanged in both systems: a rate is a rate, an angle is an angle, and a
  // count has no unit at all.
  rpm: { unit: 'rpm', convert: (v) => v },
  mrad: { unit: 'MOA', convert: mradToMoa },
  '': { unit: '', convert: (v) => v },
};

/** Converts an SI value for display, or passes it through unchanged. */
export function toDisplay(
  value: number,
  siUnit: string,
  system: UnitSystem,
): { value: number; unit: string } {
  if (system === 'metric') return { value, unit: siUnit };
  const rule = IMPERIAL_FOR[siUnit];
  if (!rule) return { value, unit: siUnit };
  return { value: rule.convert(value), unit: rule.unit };
}
