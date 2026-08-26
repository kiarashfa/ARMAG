/**
 * Barrel-length velocity — SPEC.md §8.2, the honesty rule.
 *
 * A gun's muzzle velocity for a given load is not a property of the gun and it
 * is not a property of the load. It is a property of the pair, and almost
 * nobody publishes it for the pair you want. This module is what the site does
 * about that, and the rules are absolute:
 *
 *  - An exact sourced match is used as it stands.
 *  - Between two sourced points the velocity is **interpolated**, and rendered
 *    labelled as interpolated.
 *  - **Outside the sourced range nothing is projected.** The nearest sourced
 *    figure is shown with its actual barrel length stated, so the reader can
 *    see they are being given a 4-inch number for a 3-inch barrel rather than
 *    a confident invention.
 *
 * ── The rule of thumb that never appears in this codebase ──────────────────
 * "About 25 feet per second per inch of barrel" is the most repeated number in
 * the subject and it is a fabrication with a lab coat on: the real figure
 * depends on the cartridge, the powder burn rate and where on the curve you
 * are, ranges from near zero to several times that, and can go negative. There
 * is no such constant anywhere in this repository, and `purity.test.ts`
 * asserts it — because the temptation to add one is exactly the temptation
 * this project exists to resist.
 */
import { derive, type Derived, type ValueLike } from '../provenance.ts';

/** A sourced (barrel length, velocity) pair from a cartridge's load data. */
export interface VelocityPoint {
  barrelLength: ValueLike;
  velocity: ValueLike;
}

export type VelocityBasis =
  /** A sourced measurement at exactly this barrel length. */
  | 'sourced'
  /** Interpolated between two sourced points that bracket it. */
  | 'interpolated'
  /** The nearest sourced point, because the barrel is outside the data. */
  | 'nearest-sourced'
  /** No usable data at all. */
  | 'none';

export interface VelocityResult {
  basis: VelocityBasis;
  velocity: Derived;
  /**
   * The barrel length the figure actually belongs to. Equal to the requested
   * length for `sourced` and `interpolated`; the sourced length for
   * `nearest-sourced`. This is what the page must print next to the number.
   */
  atBarrelLengthMm: number | null;
  /** Ready to render: says what the number is, without hedging. */
  caveat?: string;
}

const usable = (point: VelocityPoint): boolean =>
  point.barrelLength.value !== null && point.velocity.value !== null;

/**
 * The muzzle velocity of a load out of a given barrel length.
 *
 * Returns a `basis` alongside the number, because how the figure was arrived at
 * is not a footnote here — a reader comparing two arms needs to know which of
 * the two numbers was measured.
 */
export function velocityForBarrel(
  points: readonly VelocityPoint[],
  barrelLengthMm: number,
): VelocityResult {
  const known = points
    .filter(usable)
    .sort((a, b) => (a.barrelLength.value as number) - (b.barrelLength.value as number));

  if (known.length === 0) {
    return {
      basis: 'none',
      atBarrelLengthMm: null,
      velocity: derive({
        formula: 'no sourced velocity for this load',
        unit: 'm/s',
        inputs: [{ label: 'sourced points', of: { value: null, status: 'placeholder' } }],
        compute: () => 0,
      }),
    };
  }

  const exact = known.find((point) => point.barrelLength.value === barrelLengthMm);
  if (exact) {
    return {
      basis: 'sourced',
      atBarrelLengthMm: barrelLengthMm,
      velocity: derive({
        formula: 'measured at this barrel length',
        unit: 'm/s',
        inputs: [{ label: 'v', of: exact.velocity, unit: 'm/s' }],
        compute: ([v]) => v!,
      }),
    };
  }

  const shortest = known[0]!;
  const longest = known[known.length - 1]!;
  const shortestMm = shortest.barrelLength.value as number;
  const longestMm = longest.barrelLength.value as number;

  // Outside the sourced range: report the nearest point AS the nearest point.
  if (barrelLengthMm < shortestMm || barrelLengthMm > longestMm) {
    const nearest = barrelLengthMm < shortestMm ? shortest : longest;
    const nearestMm = nearest.barrelLength.value as number;
    return {
      basis: 'nearest-sourced',
      atBarrelLengthMm: nearestMm,
      caveat: `Measured with a ${nearestMm} mm barrel, not this arm's ${barrelLengthMm} mm. Velocity outside the sourced range is not projected.`,
      velocity: derive({
        formula: 'nearest sourced barrel length — no extrapolation (SPEC.md §8.2)',
        unit: 'm/s',
        inputs: [{ label: `v at ${nearestMm} mm`, of: nearest.velocity, unit: 'm/s' }],
        assumptions: [
          `This figure belongs to a ${nearestMm} mm barrel. It is shown because it is the closest measurement that exists, not because it applies here.`,
        ],
        compute: ([v]) => v!,
      }),
    };
  }

  let lower = known[0]!;
  let upper = known[known.length - 1]!;
  for (let i = 1; i < known.length; i += 1) {
    if ((known[i]!.barrelLength.value as number) >= barrelLengthMm) {
      lower = known[i - 1]!;
      upper = known[i]!;
      break;
    }
  }

  const lowerMm = lower.barrelLength.value as number;
  const upperMm = upper.barrelLength.value as number;

  return {
    basis: 'interpolated',
    atBarrelLengthMm: barrelLengthMm,
    caveat: `Interpolated between sourced measurements at ${lowerMm} mm and ${upperMm} mm.`,
    velocity: derive({
      formula: 'linear interpolation between the two nearest sourced barrel lengths',
      unit: 'm/s',
      // `modelStatus: 'estimated'` is the point of this whole module: an
      // interpolated figure can never present itself as verified, however
      // verified both of its endpoints are.
      modelStatus: 'estimated',
      inputs: [
        { label: `v at ${lowerMm} mm`, of: lower.velocity, unit: 'm/s' },
        { label: `v at ${upperMm} mm`, of: upper.velocity, unit: 'm/s' },
      ],
      assumptions: [
        'Velocity is assumed to vary linearly between the two measurements. Over a short span that is a reasonable reading of the data; it is not a law.',
      ],
      compute: ([vLower, vUpper]) => {
        const span = upperMm - lowerMm;
        if (span === 0) return vLower!;
        return vLower! + ((vUpper! - vLower!) * (barrelLengthMm - lowerMm)) / span;
      },
    }),
  };
}
