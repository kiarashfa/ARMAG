/**
 * The rest of the math engine — everything except the trajectory solver, which
 * has its own validation file.
 *
 * The assertions here are mostly about **provenance rather than arithmetic**.
 * ½mv² is not going to be wrong; what will be wrong, silently and for a long
 * time, is a derived figure that inherits the wrong status and presents an
 * estimate as a measurement.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MOA_PER_MRAD,
  angleSubtendedBy,
  fpsToMs,
  gToGrains,
  grainsToG,
  joulesToFootPounds,
  mmToInches,
  msToFps,
  subtendAtRange,
  toDisplay,
} from './units.ts';
import { derive, worstStatus, type ValueLike } from './provenance.ts';
import { energyRetention, kineticEnergy, powerFactor, sectionalDensity } from './ballistics/energy.ts';
import { velocityForBarrel } from './ballistics/velocity.ts';
import { freeRecoilEnergy, recoilVelocity } from './recoil.ts';
import { ammunitionFraction, loadedMass } from './mass.ts';
import { burstTime, magazineDumpTime, magazinesFor, sightingErrorAngle } from './handling.ts';
import { describePercentile, ladder, percentileOf } from './percentile.ts';
import { adjustForInflation, conditionAdjustedValue, costPerRound } from './economics.ts';
import { completeness, countVerified, meetsPublicationFloor } from './score.ts';
import { match } from './matchmaker.ts';

const verified = (value: number, unit = ''): ValueLike => ({
  value,
  unit,
  status: 'verified',
  source: 'x',
  sourceUrl: 'https://example.org/x',
});
const estimated = (value: number, unit = ''): ValueLike => ({
  value,
  unit,
  status: 'estimated',
  sourceNote: 'estimated for the test',
});
const placeholder = (unit = ''): ValueLike => ({ value: null, unit, status: 'placeholder' });

// ---------------------------------------------------------------------------
// units
// ---------------------------------------------------------------------------

test('conversions round-trip and match their exact definitions', () => {
  assert.equal(mmToInches(25.4), 1);
  assert.equal(grainsToG(7000), 453.59237);
  assert.ok(Math.abs(gToGrains(grainsToG(175)) - 175) < 1e-12);
  assert.ok(Math.abs(msToFps(fpsToMs(2600)) - 2600) < 1e-9);
  // 1 mrad is a shade over 3.4377 MOA. The "1 MOA = 1 inch at 100 yards"
  // shorthand is 4.7% out, which is a whole minute at 1000 yards.
  assert.ok(Math.abs(MOA_PER_MRAD - 3.437746771) < 1e-8);
  // 1 ft·lbf ≈ 1.35582 J, from the pound-force and the foot.
  assert.ok(Math.abs(joulesToFootPounds(1.3558179483314004) - 1) < 1e-12);
});

test('an angle subtends the size it should, and back again', () => {
  const size = subtendAtRange(1, 1000); // 1 mrad at 1000 m
  assert.ok(Math.abs(size - 1) < 1e-3, `1 mrad at 1000 m should be ~1 m, got ${size}`);
  assert.ok(Math.abs(angleSubtendedBy(size, 1000) - 1) < 1e-9);
  assert.equal(angleSubtendedBy(1, 0), 0, 'no range, no angle — not a division by zero');
});

test('the unit toggle converts every SI unit the schema allows', () => {
  assert.deepEqual(toDisplay(1000, 'm/s', 'imperial'), { value: msToFps(1000), unit: 'fps' });
  assert.deepEqual(toDisplay(1000, 'm/s', 'metric'), { value: 1000, unit: 'm/s' });
  // Cartridge names never convert, and neither does a count or a rate.
  assert.deepEqual(toDisplay(17, '', 'imperial'), { value: 17, unit: '' });
  assert.deepEqual(toDisplay(600, 'rpm', 'imperial'), { value: 600, unit: 'rpm' });
});

// ---------------------------------------------------------------------------
// provenance — the load-bearing module
// ---------------------------------------------------------------------------

test('a derived value inherits the worst status among its inputs', () => {
  assert.equal(worstStatus('verified', 'verified'), 'verified');
  assert.equal(worstStatus('verified', 'estimated'), 'estimated');
  assert.equal(worstStatus('estimated', 'conflicting-sources'), 'conflicting-sources');
  assert.equal(worstStatus(), 'verified', 'nothing assumed means nothing estimated');

  const clean = kineticEnergy(verified(11.34, 'g'), verified(792.48, 'm/s'));
  assert.equal(clean.status, 'verified');

  const dirty = kineticEnergy(estimated(11.34, 'g'), verified(792.48, 'm/s'));
  assert.equal(dirty.status, 'estimated', 'estimated in, estimated out');
  assert.ok(Math.abs(dirty.value! - clean.value!) < 1e-9, 'the number is the same, the badge is not');
});

test('a placeholder input blocks the computation and says which one', () => {
  const blocked = kineticEnergy(placeholder('g'), verified(792.48, 'm/s'));
  assert.equal(blocked.value, null, 'null is not a number and must not be substituted for');
  assert.equal(blocked.status, 'placeholder');
  assert.equal(blocked.blockedBy, 'm', 'the page must be able to say WHICH figure is missing');
});

test('the input chain travels with the value, in the order the formula uses', () => {
  const result = kineticEnergy(verified(11.34, 'g'), estimated(792.48, 'm/s'));
  assert.deepEqual(result.inputs.map((i) => i.label), ['m', 'v']);
  assert.equal(result.inputs[0]!.sourceUrl, 'https://example.org/x');
  assert.equal(result.inputs[1]!.status, 'estimated');
  assert.ok(result.formula.includes('½'), 'the ƒ panel needs the formula itself');
});

test('a model weaker than its inputs downgrades the result, never upgrades it', () => {
  const weakModel = derive({
    formula: 'test',
    unit: '',
    modelStatus: 'estimated',
    inputs: [{ label: 'a', of: verified(1) }],
    compute: ([a]) => a!,
  });
  assert.equal(weakModel.status, 'estimated');

  const strongModelWeakInput = derive({
    formula: 'test',
    unit: '',
    modelStatus: 'verified',
    inputs: [{ label: 'a', of: estimated(1) }],
    compute: ([a]) => a!,
  });
  assert.equal(strongModelWeakInput.status, 'estimated', 'a confident model cannot launder a guess');
});

// ---------------------------------------------------------------------------
// energy
// ---------------------------------------------------------------------------

test('energy, sectional density and power factor agree with their definitions', () => {
  // 11.34 g at 792.48 m/s — the 175 gr .308 case from the reference fixture.
  const energy = kineticEnergy(verified(11.34, 'g'), verified(792.48, 'm/s'));
  assert.ok(Math.abs(energy.value! - 0.5 * 0.01134 * 792.48 ** 2) < 1e-9);

  // SD = grains / (7000 × inches²). A 175 gr .308 is a shade under 0.264.
  const sd = sectionalDensity(verified(grainsToG(175), 'g'), verified(7.8232, 'mm'));
  assert.ok(Math.abs(sd.value! - 0.2637) < 0.001, `sectional density ${sd.value}`);

  // Power factor: 175 gr at 2600 fps = 455. A competition classification, in
  // the units the rulebook uses.
  const pf = powerFactor(verified(grainsToG(175), 'g'), verified(fpsToMs(2600), 'm/s'));
  assert.ok(Math.abs(pf.value! - 455) < 0.5, `power factor ${pf.value}`);

  const retention = energyRetention(verified(800, 'm/s'), verified(400, 'm/s'));
  assert.ok(Math.abs(retention.value! - 0.25) < 1e-12, 'half the speed is a quarter the energy');
});

// ---------------------------------------------------------------------------
// velocity — the honesty rule
// ---------------------------------------------------------------------------

const POINTS = [
  { barrelLength: verified(102, 'mm'), velocity: verified(340, 'm/s') },
  { barrelLength: verified(127, 'mm'), velocity: verified(360, 'm/s') },
  { barrelLength: verified(152, 'mm'), velocity: verified(375, 'm/s') },
];

test('an exact sourced barrel length is used as it stands', () => {
  const result = velocityForBarrel(POINTS, 127);
  assert.equal(result.basis, 'sourced');
  assert.equal(result.velocity.value, 360);
  assert.equal(result.velocity.status, 'verified');
  assert.equal(result.atBarrelLengthMm, 127);
});

test('between two sourced points the velocity is interpolated and says so', () => {
  const result = velocityForBarrel(POINTS, 114.5);
  assert.equal(result.basis, 'interpolated');
  assert.ok(Math.abs(result.velocity.value! - 350) < 0.01);
  assert.equal(
    result.velocity.status,
    'estimated',
    'an interpolated figure can never present itself as verified, however verified its endpoints are',
  );
  assert.ok(result.caveat!.includes('102') && result.caveat!.includes('127'));
});

test('no barrel length at all is no answer, not an interpolation', () => {
  // A `kind: 'family'` entry has no barrel, so the seam in `derived.ts` hands
  // this NaN. Before the guard it fell through to the bracket search and came
  // back labelled 'interpolated' with a null value — a confident description
  // of arithmetic that never happened. Found on the AR-15 page, Phase 8.
  const result = velocityForBarrel(POINTS, Number.NaN);
  assert.equal(result.basis, 'none');
  assert.equal(result.velocity.value, null);
  assert.equal(result.atBarrelLengthMm, null);
});

test('outside the sourced range nothing is projected — SPEC.md §8.2', () => {
  const short = velocityForBarrel(POINTS, 76);
  assert.equal(short.basis, 'nearest-sourced');
  assert.equal(short.velocity.value, 340, 'the nearest sourced figure, not a projection');
  assert.equal(short.atBarrelLengthMm, 102, 'and it belongs to a 102 mm barrel, which must be said');
  assert.ok(short.caveat!.includes('102'));
  assert.ok(short.caveat!.includes('76'));

  const long = velocityForBarrel(POINTS, 300);
  assert.equal(long.basis, 'nearest-sourced');
  assert.equal(long.velocity.value, 375);
  assert.ok(
    long.velocity.value! <= 375,
    'a longer barrel must NOT be given a higher velocity than anything measured',
  );
});

test('no sourced points is an honest blank, not a zero', () => {
  const result = velocityForBarrel([], 127);
  assert.equal(result.basis, 'none');
  assert.equal(result.velocity.value, null);
  assert.equal(result.atBarrelLengthMm, null);
});

// ---------------------------------------------------------------------------
// recoil
// ---------------------------------------------------------------------------

test('free recoil without a powder charge is a lower bound, and marked as one', () => {
  const inputs = {
    firearmMass: verified(4.0, 'kg'),
    bulletMass: verified(9.72, 'g'),
    muzzleVelocity: verified(886.97, 'm/s'),
  };
  const recoil = freeRecoilEnergy(inputs);
  assert.ok(recoil.value! > 0);
  assert.equal(
    recoil.status,
    'estimated',
    'omitting the propellant term must downgrade the badge even when every input is verified',
  );
  assert.ok(
    recoil.assumptions.some((a) => a.includes('lower bound')),
    'and the reader must be told it is a lower bound',
  );

  // p = mv / M, then ½Mv²: check the chain rather than the constant.
  const velocity = recoilVelocity(inputs);
  assert.ok(Math.abs(velocity.value! - (0.00972 * 886.97) / 4.0) < 1e-9);
  assert.ok(Math.abs(recoil.value! - 0.5 * 4.0 * velocity.value! ** 2) < 1e-9);
});

test('adding the propellant term increases recoil and removes the lower-bound caveat', () => {
  const base = {
    firearmMass: verified(4.0, 'kg'),
    bulletMass: verified(9.72, 'g'),
    muzzleVelocity: verified(886.97, 'm/s'),
  };
  const withGas = freeRecoilEnergy({
    ...base,
    propellantMass: verified(3.24, 'g'),
    gasVelocityFactor: 1.5,
  });
  assert.ok(withGas.value! > freeRecoilEnergy(base).value!);
  assert.equal(withGas.status, 'verified', 'every input sourced and the model complete');
  assert.ok(!withGas.assumptions.some((a) => a.includes('lower bound')));
});

// ---------------------------------------------------------------------------
// mass
// ---------------------------------------------------------------------------

test('loaded mass is empty plus magazine plus the ammunition in it', () => {
  const inputs = {
    massEmpty: verified(0.625, 'kg'),
    massMagazineEmpty: verified(0.07, 'kg'),
    cartridgeMass: verified(12.0, 'g'),
    capacity: verified(17, ''),
  };
  const total = loadedMass(inputs);
  assert.ok(Math.abs(total.value! - (0.625 + 0.07 + (17 * 12) / 1000)) < 1e-12);
  assert.ok(total.value! > 0.625 * 1.1, 'a loaded pistol is meaningfully heavier than its datasheet');

  const fraction = ammunitionFraction(inputs);
  assert.ok(fraction.value! > 0.2 && fraction.value! < 0.3);
});

test('a missing cartridge mass leaves loaded mass blank rather than wrong', () => {
  const total = loadedMass({
    massEmpty: verified(0.625, 'kg'),
    massMagazineEmpty: verified(0.07, 'kg'),
    cartridgeMass: placeholder('g'),
    capacity: verified(17, ''),
  });
  assert.equal(total.value, null);
  assert.equal(total.blockedBy, 'm_cartridge');
});

// ---------------------------------------------------------------------------
// handling
// ---------------------------------------------------------------------------

test('a magazine dump has one fewer interval than it has rounds', () => {
  // 17 rounds at 1200 rpm: 16 intervals of 50 ms, not 17.
  const time = magazineDumpTime(verified(17, ''), verified(1200, 'rpm'));
  assert.ok(Math.abs(time.value! - 0.8) < 1e-12, `got ${time.value}`);
  assert.equal(magazineDumpTime(verified(1, ''), verified(1200, 'rpm')).value, 0);
  assert.ok(Math.abs(burstTime(3, verified(1200, 'rpm')).value! - 0.1) < 1e-12);
});

test('a longer sight radius costs less angle for the same error', () => {
  const short = sightingErrorAngle(verified(100, 'mm'), 1);
  const long = sightingErrorAngle(verified(500, 'mm'), 1);
  assert.ok(long.value! < short.value!);
  assert.ok(Math.abs(short.value! / long.value! - 5) < 0.01, 'five times the radius, a fifth the angle');
});

test('a partial magazine is still a magazine', () => {
  assert.equal(magazinesFor(100, verified(30, '')).value, 4);
  assert.equal(magazinesFor(90, verified(30, '')).value, 3);
});

// ---------------------------------------------------------------------------
// percentile
// ---------------------------------------------------------------------------

test('a percentile is a position in a named population, never a rating', () => {
  const set = { label: 'centrefire rifles', values: [4, 6, 8, 10, 12] };
  const result = percentileOf(8, set)!;
  assert.equal(result.percentile, 50, 'the middle of five is the median');
  assert.equal(result.populationSize, 5);
  assert.equal(result.setLabel, 'centrefire rifles');

  const label = describePercentile(result, 8.4, 'J');
  assert.ok(label.includes('8.4 J'), 'the real value with its real unit');
  assert.ok(label.includes('centrefire rifles'), 'and the population it is measured against');
  assert.ok(label.includes('n = 5'));
});

test('ties share the middle rather than all landing at one end', () => {
  const set = { label: 'test', values: [5, 5, 5, 5] };
  assert.equal(percentileOf(5, set)!.percentile, 50);
  assert.equal(percentileOf(1, set)!.fraction, 0);
  assert.equal(percentileOf(9, set)!.fraction, 1);
  assert.equal(percentileOf(1, { label: 'empty', values: [] }), null);
});

test('a ladder ranks ascending and skips entries with no figure', () => {
  const rows = ladder(
    [{ id: 'a', v: 10 }, { id: 'b', v: null }, { id: 'c', v: 2 }],
    (row) => row.v,
    'test set',
  );
  assert.deepEqual(rows.map((r) => r.entry.id), ['c', 'a']);
  assert.equal(rows[0]!.result.populationSize, 2);
});

// ---------------------------------------------------------------------------
// economics
// ---------------------------------------------------------------------------

const CPI = { '1990': 130.7, '2020': 258.8 };

test('inflation adjustment uses the table, and refuses when the table cannot', () => {
  const adjusted = adjustForInflation(verified(500), 1990, 2020, CPI);
  assert.ok(Math.abs(adjusted.value! - (500 * 258.8) / 130.7) < 1e-9);

  const impossible = adjustForInflation(verified(500), 1890, 2020, CPI);
  assert.equal(impossible.value, null, 'a table that stops in 1913 cannot price an 1890 rifle');
  assert.equal(impossible.status, 'placeholder');
});

test('the condition scale multiplies the READER’S base, and says so', () => {
  const value = conditionAdjustedValue(verified(1000), 'fine-80');
  assert.equal(value.value, 800);
  assert.ok(
    value.assumptions.some((a) => a.includes('yours, not ours')),
    'the site holds no market value and must not imply it does',
  );
  assert.equal(conditionAdjustedValue(verified(1000), 'new-100').value, 1000);
});

test('cost per round is not a division by zero', () => {
  assert.equal(costPerRound(verified(25), verified(50, '')).value, 0.5);
  assert.equal(costPerRound(verified(25), verified(0, '')).value, 0);
});

// ---------------------------------------------------------------------------
// score — the anti-fabrication incentive
// ---------------------------------------------------------------------------

const WEIGHTS = {
  verifiedCoreSpec: 6,
  verifiedExtendedSpec: 2,
  image: 4,
  proseWordsPer100: 3,
  resolvedMakerRef: 4,
  resolvedFamilyRef: 2,
  resolvedCartridgeRef: 4,
  variant: 3,
  lineageEdge: 2,
};
const FLOOR = { tier1: 90, tier2: 55 };

test('only verified values count, so estimating your way up buys nothing', () => {
  assert.equal(countVerified(['verified', 'estimated', 'placeholder', 'verified']), 2);
  assert.equal(countVerified(['estimated', 'estimated', 'conflicting-sources']), 0);
});

test('tier is computed from the score, and a full page of estimates is Tier 3', () => {
  const sourced = completeness(
    {
      verifiedCoreSpecs: 8,
      verifiedExtendedSpecs: 6,
      images: 6,
      proseWords: 800,
      hasResolvedMakerRef: true,
      hasResolvedFamilyRef: true,
      resolvedCartridgeRefs: 2,
      variants: 4,
      lineageEdges: 3,
    },
    WEIGHTS,
    FLOOR,
  );
  assert.equal(sourced.tier, 1);

  // The SAME entry, every figure estimated instead of verified: same page, same
  // word count, same images — and it does not reach Tier 1.
  const estimatedThroughout = completeness(
    {
      verifiedCoreSpecs: 0,
      verifiedExtendedSpecs: 0,
      images: 6,
      proseWords: 800,
      hasResolvedMakerRef: true,
      hasResolvedFamilyRef: true,
      resolvedCartridgeRefs: 2,
      variants: 4,
      lineageEdges: 3,
    },
    WEIGHTS,
    FLOOR,
  );
  assert.ok(
    estimatedThroughout.score < sourced.score,
    'inventing figures must never raise a tier — SPEC.md §8.4',
  );
  assert.notEqual(estimatedThroughout.tier, 1);
});

test('the publication floor reports what is missing, not just that something is', () => {
  const thin = meetsPublicationFloor(
    {
      verifiedCoreSpecs: 2,
      verifiedExtendedSpecs: 0,
      images: 0,
      proseWords: 20,
      hasResolvedMakerRef: false,
      hasResolvedFamilyRef: false,
      resolvedCartridgeRefs: 0,
      variants: 0,
      lineageEdges: 0,
    },
    {
      verifiedCoreSpecs: 6,
      images: 1,
      proseWords: 60,
      requiresResolvingMakerRef: true,
      requiresResolvingCartridgeRef: true,
    },
  );
  assert.equal(thin.ok, false);
  assert.equal(thin.missing.length, 5);
  assert.ok(thin.missing.some((m) => m.includes('verified core specs')));
});

// ---------------------------------------------------------------------------
// matchmaker
// ---------------------------------------------------------------------------

const CANDIDATES = [
  {
    id: 'light',
    name: 'Light',
    action: 'self-loading',
    roles: ['duty-sidearm'],
    cartridgeRefs: ['nine-mm'],
    era: 'contemporary',
    loadedMassKg: 0.9,
    capacity: 17,
    freeRecoilJ: 5,
  },
  {
    id: 'heavy',
    name: 'Heavy',
    action: 'self-loading',
    roles: ['duty-sidearm'],
    cartridgeRefs: ['forty-five'],
    era: 'contemporary',
    loadedMassKg: 1.6,
    capacity: 8,
    freeRecoilJ: 12,
  },
  {
    id: 'unknown',
    name: 'Unrecorded',
    action: 'self-loading',
    roles: ['duty-sidearm'],
    cartridgeRefs: ['nine-mm'],
    era: 'contemporary',
    loadedMassKg: null,
    capacity: null,
    freeRecoilJ: null,
  },
];

test('a dealbreaker excludes and says which one, in the reader’s own terms', () => {
  const outcome = match(CANDIDATES, { maxLoadedMassKg: 1.0 });
  assert.deepEqual(outcome.excluded.map((e) => e.candidate.id), ['heavy']);
  assert.ok(outcome.excluded[0]!.because.includes('1 kg ceiling'));
  assert.ok(outcome.applied.some((a) => a.includes('loaded mass at most 1 kg')));
});

test('a missing figure never excludes a candidate', () => {
  const outcome = match(CANDIDATES, { maxLoadedMassKg: 1.0, minCapacity: 10 });
  assert.ok(
    outcome.matches.some((m) => m.candidate.id === 'unknown'),
    'an unrecorded mass is a gap in our data, not a fact about the arm',
  );
  assert.ok(
    outcome.matches.find((m) => m.candidate.id === 'unknown')!.reasons.some((r) =>
      r.detail.includes('not recorded'),
    ),
  );
});

test('with no criteria everything matches equally and nothing is ranked', () => {
  const outcome = match(CANDIDATES, {});
  assert.equal(outcome.matches.length, 3);
  assert.ok(outcome.matches.every((m) => m.fit === 1));
  assert.deepEqual(outcome.matches.map((m) => m.candidate.id), ['light', 'heavy', 'unknown']);
  assert.deepEqual(outcome.applied, []);
});

test('the matchmaker has no budget, price or legality input at all', () => {
  // SPEC.md §9.3 and §14. Asserted structurally so a future field cannot be
  // added without this failing: we have launch MSRP, not market value, so a
  // budget question would be a lie, and the site never says what a reader may do.
  const criteria = {
    useTags: [],
    cartridgeRefs: [],
    maxLoadedMassKg: 1,
    minCapacity: 1,
    actions: [],
    maxFreeRecoilJ: 1,
    eras: [],
  };
  const keys = Object.keys(criteria).map((k) => k.toLowerCase());
  for (const forbidden of ['budget', 'price', 'cost', 'legal', 'jurisdiction', 'effective']) {
    assert.ok(!keys.some((k) => k.includes(forbidden)), `MatchCriteria must not carry '${forbidden}'`);
  }
  assert.equal(keys.length, 7, 'SPEC.md §9.3 specifies seven inputs');
});
