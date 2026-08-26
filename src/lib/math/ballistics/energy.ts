/**
 * Muzzle and retained energy, momentum, and the competition indices —
 * SPEC.md §8.1.
 *
 * ── What is NOT here, and will not be ──────────────────────────────────────
 * Taylor's Knock-Out factor is listed in SPEC.md §8.1 and is deliberately
 * omitted, because SPEC.md §14 forbids "damage, lethality, 'stopping power' or
 * wounding metric, ever" and TKO is exactly one: John Taylor devised it in the
 * 1940s to rank dangerous-game rifles by their stunning effect, it has no
 * physical meaning (its dimensions are momentum × length), and it is the kind
 * of number this project exists not to publish. The two sections of SPEC.md
 * contradict each other; the red line wins over the feature list, and Kiarash
 * has been told so rather than the omission being made quietly.
 *
 * Kinetic energy and momentum stay, prominently. They are physics: two
 * quantities that fall straight out of mass and velocity, mean exactly what
 * they say, and claim nothing about what happens at the other end.
 *
 * Pure. No DOM, no I/O, no framework import.
 */
import { derive, given, type Derived, type ValueLike } from '../provenance.ts';
import { gToGrains, mmToInches, msToFps } from '../units.ts';

/**
 * Kinetic energy, E = ½mv².
 *
 * Inputs are SI — grams and metres per second — because SI is what the
 * database stores. The conversion to grains and feet per second happens at the
 * edge of the site, never here.
 */
export function kineticEnergy(bulletMass: ValueLike, velocity: ValueLike): Derived {
  return derive({
    formula: 'E = ½ · m · v²',
    unit: 'J',
    inputs: [
      { label: 'm', of: bulletMass, unit: 'g' },
      { label: 'v', of: velocity, unit: 'm/s' },
    ],
    compute: ([massG, velocityMs]) => 0.5 * (massG! / 1000) * velocityMs! * velocityMs!,
  });
}

/** Momentum, p = mv. Conserved, unlike energy, and the basis of free recoil. */
export function momentum(bulletMass: ValueLike, velocity: ValueLike): Derived {
  return derive({
    formula: 'p = m · v',
    unit: 'kg·m/s',
    inputs: [
      { label: 'm', of: bulletMass, unit: 'g' },
      { label: 'v', of: velocity, unit: 'm/s' },
    ],
    compute: ([massG, velocityMs]) => (massG! / 1000) * velocityMs!,
  });
}

/**
 * Sectional density — mass per unit frontal area.
 *
 * Reported in the conventional lb/in², because that is the scale every
 * published figure uses and a reader comparing ours against a manufacturer's
 * needs the same number, not a metrically-tidier one. It is a shape-independent
 * measure of how much mass is behind each unit of cross-section, and it is an
 * input to the ballistic coefficient — not a claim about anything else.
 */
export function sectionalDensity(bulletMass: ValueLike, bulletDiameter: ValueLike): Derived {
  return derive({
    formula: 'SD = mass(gr) / (7000 · diameter(in)²)',
    unit: 'lb/in²',
    inputs: [
      { label: 'mass', of: bulletMass, unit: 'g' },
      { label: 'diameter', of: bulletDiameter, unit: 'mm' },
    ],
    assumptions: [
      'Reported in the conventional lb/in² so it is directly comparable with published figures.',
    ],
    compute: ([massG, diameterMm]) => {
      const inches = mmToInches(diameterMm!);
      return gToGrains(massG!) / (7000 * inches * inches);
    },
  });
}

/**
 * IPSC / USPSA power factor.
 *
 * A **competition classification rule**, not a physical quantity and not a
 * claim about effect: the sport defines major and minor scoring by this
 * threshold, so a competitor genuinely needs the number. Its units are grain
 * feet per second by definition, which is why this is the one function here
 * that converts away from SI — reporting it in SI would produce a figure that
 * matches no rulebook and answers nobody's question.
 */
export function powerFactor(bulletMass: ValueLike, velocity: ValueLike): Derived {
  return derive({
    formula: 'PF = mass(gr) · velocity(fps) / 1000',
    unit: 'gr·fps/1000',
    inputs: [
      { label: 'mass', of: bulletMass, unit: 'g' },
      { label: 'velocity', of: velocity, unit: 'm/s' },
    ],
    assumptions: [
      'A competition classification defined by the IPSC and USPSA rulebooks, stated in their units. It describes a scoring category, not an effect.',
    ],
    compute: ([massG, velocityMs]) => (gToGrains(massG!) * msToFps(velocityMs!)) / 1000,
  });
}

/**
 * The fraction of muzzle energy still carried at a given velocity.
 *
 * Retained energy itself comes from the trajectory solver, which is where the
 * velocity at range is worked out; this is the ratio a reader actually wants
 * when comparing two cartridges over distance.
 */
export function energyRetention(muzzleVelocity: ValueLike, velocityAtRange: ValueLike): Derived {
  return derive({
    formula: 'E(x) / E₀ = (v(x) / v₀)²',
    unit: '',
    inputs: [
      { label: 'v₀', of: muzzleVelocity, unit: 'm/s' },
      { label: 'v(x)', of: velocityAtRange, unit: 'm/s' },
    ],
    compute: ([v0, vx]) => (v0! === 0 ? 0 : (vx! * vx!) / (v0! * v0!)),
  });
}

/**
 * Convenience for callers that already hold plain numbers — a calculator page
 * where the reader typed both figures, for instance.
 */
export const kineticEnergyOf = (bulletMassG: number, velocityMs: number): number =>
  kineticEnergy(given(bulletMassG, 'g'), given(velocityMs, 'm/s')).value as number;
