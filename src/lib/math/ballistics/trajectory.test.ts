/**
 * Solver validation — SPEC.md §8.3, and the reason the site can claim accuracy
 * instead of asserting it.
 *
 * Four layers, weakest evidence last:
 *
 *  1. **Analytic.** With drag removed the solver must reproduce the closed-form
 *     parabola. This tests the integrator alone, against an answer that is
 *     exactly right rather than merely authoritative.
 *  2. **An independent implementation.** py-ballisticcalc 2.2.0's RK4 engine,
 *     run once at pinned inputs, its output committed as a fixture with the
 *     version and conditions recorded. Not a dependency — a corpus.
 *  3. **Manufacturer-published tables.** Two Hornady .308 loads. The energy
 *     column is checked exactly, because energy is a closed form over the
 *     published velocity and mass with no free parameter. The drop column is
 *     checked against a BC fitted to the published velocities, which is a real
 *     test of the integrator: drop comes from time of flight and gravity, and
 *     is not what the fit was tuned on.
 *  4. **Invariants.** Monotonic velocity decay, zero round-tripping, wind
 *     acting the way wind acts.
 *
 * Tolerances are stated per assertion, in the units a reader would care about,
 * and are deliberately tight enough to fail if the physics changes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { STANDARD_GRAVITY_MS2, joulesToFootPounds, grainsToG, fpsToMs, yardsToM, mToYards, mmToInches } from '../units.ts';
import { solveTrajectory, solveZeroAngle, maxPointBlankRange } from './trajectory.ts';
import { dragCoefficient, standardAtmosphere, STANDARD_ATMOSPHERE } from './drag.ts';
import { G1, G7 } from './drag-tables.ts';

const readFixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../../test-fixtures/ballistics/${name}`, import.meta.url), 'utf8'));

// ---------------------------------------------------------------------------
// 1. Analytic — the integrator against a closed form
// ---------------------------------------------------------------------------

test('with drag removed the solver reproduces the vacuum parabola exactly', () => {
  // An enormous ballistic coefficient makes drag vanish without needing a
  // special case in the solver, so this exercises the real code path.
  const projectile = { ballisticCoefficient: 1e12, dragModel: 'G1' as const };
  const v0 = 800;
  const angleMrad = 10;
  const setup = { muzzleVelocityMs: v0, launchAngleMrad: angleMrad, sightHeightMm: 0 };

  const ranges = [100, 300, 600, 1000];
  const points = solveTrajectory(projectile, setup, { atRangesM: ranges, maxDropM: 1000 });
  assert.equal(points.length, ranges.length);

  const theta = angleMrad / 1000;
  for (const point of points) {
    const x = point.rangeM;
    const expectedDrop =
      x * Math.tan(theta) -
      (STANDARD_GRAVITY_MS2 * x * x) / (2 * (v0 * Math.cos(theta)) ** 2);
    const expectedTime = x / (v0 * Math.cos(theta));

    assert.ok(
      Math.abs(point.dropM - expectedDrop) < 1e-6,
      `drop at ${x} m: ${point.dropM} vs closed form ${expectedDrop}`,
    );
    assert.ok(
      Math.abs(point.timeS - expectedTime) < 1e-9,
      `time at ${x} m: ${point.timeS} vs ${expectedTime}`,
    );
    // Speed is NOT constant in a vacuum — gravity keeps changing the vertical
    // component. The horizontal component is what nothing acts on.
    const expectedVy = v0 * Math.sin(theta) - STANDARD_GRAVITY_MS2 * expectedTime;
    const expectedSpeed = Math.hypot(v0 * Math.cos(theta), expectedVy);
    assert.ok(
      Math.abs(point.velocityMs - expectedSpeed) < 1e-6,
      `speed at ${x} m: ${point.velocityMs} vs closed form ${expectedSpeed}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. An independent implementation
// ---------------------------------------------------------------------------

test('matches py-ballisticcalc on velocity, drop and time of flight', () => {
  const fixture = readFixture('reference-trajectories.json');
  const failures: string[] = [];

  for (const testCase of fixture.cases) {
    const input = testCase.input;
    const projectile = {
      ballisticCoefficient: input.ballisticCoefficient,
      dragModel: input.dragModel as 'G1' | 'G7',
      massG: input.bulletMassG,
    };
    const base = {
      muzzleVelocityMs: input.muzzleVelocityMs,
      sightHeightMm: input.sightHeightMm,
      atmosphere: STANDARD_ATMOSPHERE,
    };

    // Our own zero solution must agree with theirs before anything else can.
    const zeroAngle = solveZeroAngle(projectile, base, input.zeroRangeM);
    assert.ok(zeroAngle !== null, `${testCase.id}: no zero solution`);
    const zeroError = Math.abs(zeroAngle! - input.zeroAngleMrad);
    if (zeroError > 0.005) {
      failures.push(
        `${testCase.id}: zero angle ${zeroAngle!.toFixed(4)} mrad vs reference ${input.zeroAngleMrad} mrad`,
      );
    }

    const ranges = testCase.rows.map((r: { rangeM: number }) => r.rangeM);
    const points = solveTrajectory(
      projectile,
      { ...base, launchAngleMrad: input.zeroAngleMrad },
      { atRangesM: ranges, maxDropM: 1000 },
    );
    assert.equal(points.length, ranges.length, `${testCase.id}: missing rows`);

    for (const [i, row] of testCase.rows.entries()) {
      const point = points[i]!;

      // Velocity: 0.15% of the reference. The two solvers differ only in step
      // size and interpolation, so anything larger means a physics difference.
      const velocityError = Math.abs(point.velocityMs - row.velocityMs) / row.velocityMs;
      if (velocityError > 0.0015) {
        failures.push(
          `${testCase.id} @ ${row.rangeM} m: velocity ${point.velocityMs.toFixed(2)} vs ${row.velocityMs} m/s (${(velocityError * 100).toFixed(3)}%)`,
        );
      }

      // Drop: 10 mm, or 1% of the drop where the drop is large. At 900 m the
      // reference drops 11 m, and holding 10 mm there would be asserting a
      // precision neither solver has.
      const dropTolerance = Math.max(0.01, Math.abs(row.dropM) * 0.01);
      if (Math.abs(point.dropM - row.dropM) > dropTolerance) {
        failures.push(
          `${testCase.id} @ ${row.rangeM} m: drop ${point.dropM.toFixed(4)} vs ${row.dropM} m`,
        );
      }

      // Time of flight: 1 ms or 0.5%.
      const timeTolerance = Math.max(0.001, row.timeS * 0.005);
      if (Math.abs(point.timeS - row.timeS) > timeTolerance) {
        failures.push(
          `${testCase.id} @ ${row.rangeM} m: time ${point.timeS.toFixed(5)} vs ${row.timeS} s`,
        );
      }
    }
  }

  assert.equal(
    failures.length,
    0,
    `${failures.length} disagreement(s) with the reference implementation:\n  ${failures.join('\n  ')}`,
  );
});

// ---------------------------------------------------------------------------
// 3. Manufacturer-published tables
// ---------------------------------------------------------------------------

test('reproduces the energy column of two published Hornady tables exactly', () => {
  const fixture = readFixture('published-tables.json');
  const failures: string[] = [];

  for (const table of fixture.tables) {
    const massG = grainsToG(table.bulletMassGrains);
    for (const row of table.rows) {
      const velocityMs = fpsToMs(row.velocityFps);
      const energyFtLb = joulesToFootPounds(0.5 * (massG / 1000) * velocityMs * velocityMs);
      // Published to the nearest ft·lbf, so agreeing to within 1 is exact
      // agreement. 2 allows for the manufacturer rounding velocity before
      // computing energy, which is the only other thing it could be.
      if (Math.abs(energyFtLb - row.energyFtLb) > 2) {
        failures.push(
          `${table.id} @ ${row.yards} yd: ${energyFtLb.toFixed(1)} vs published ${row.energyFtLb} ft·lbf`,
        );
      }
    }
  }

  assert.equal(failures.length, 0, `energy mismatches:\n  ${failures.join('\n  ')}`);
});

test('reproduces the drop column of two published Hornady tables', () => {
  const fixture = readFixture('published-tables.json');
  const failures: string[] = [];

  for (const table of fixture.tables) {
    const massG = grainsToG(table.bulletMassGrains);
    const muzzleMs = fpsToMs(table.rows[0].velocityFps);
    const last = table.rows[table.rows.length - 1];

    // Hornady does not publish the BC, so rather than borrowing one from
    // elsewhere and calling it theirs, fit a G1 BC to the velocity they DO
    // publish at the furthest range. Bisection on a monotonic relationship.
    const velocityAt = (bc: number, rangeM: number) => {
      const points = solveTrajectory(
        { ballisticCoefficient: bc, dragModel: 'G1', massG },
        { muzzleVelocityMs: muzzleMs, launchAngleMrad: 0, sightHeightMm: table.sightHeightInches * 25.4 },
        { atRangesM: [rangeM], maxDropM: 1000 },
      );
      return points[0]!.velocityMs;
    };
    const targetV = fpsToMs(last.velocityFps);
    const targetRange = yardsToM(last.yards);
    let low = 0.1;
    let high = 2.0;
    for (let i = 0; i < 50; i += 1) {
      const mid = (low + high) / 2;
      if (velocityAt(mid, targetRange) < targetV) low = mid;
      else high = mid;
    }
    const bc = (low + high) / 2;

    // Sanity: a .308 match bullet's G1 BC lives in this band. If the fit lands
    // outside it, the solver — not the fit — is what is wrong.
    assert.ok(bc > 0.35 && bc < 0.75, `${table.id}: fitted G1 BC ${bc.toFixed(3)} is not plausible`);

    const projectile = { ballisticCoefficient: bc, dragModel: 'G1' as const, massG };
    const setup = {
      muzzleVelocityMs: muzzleMs,
      sightHeightMm: table.sightHeightInches * 25.4,
    };
    const zeroAngle = solveZeroAngle(projectile, setup, yardsToM(table.zeroYards));
    assert.ok(zeroAngle !== null, `${table.id}: no zero solution`);

    const ranges = table.rows.map((r: { yards: number }) => yardsToM(r.yards));
    const points = solveTrajectory(
      projectile,
      { ...setup, launchAngleMrad: zeroAngle! },
      { atRangesM: ranges, maxDropM: 1000 },
    );

    for (const [i, row] of table.rows.entries()) {
      const dropInches = mmToInches(points[i]!.dropM * 1000);
      // 1.5 inches at 500 yards is a fifth of a minute of angle — inside the
      // rounding of a table printed to a tenth of an inch at 100 yards and to
      // whole inches at 500.
      if (Math.abs(dropInches - row.trajectoryInches) > 1.5) {
        failures.push(
          `${table.id} @ ${row.yards} yd: drop ${dropInches.toFixed(2)}" vs published ${row.trajectoryInches}"`,
        );
      }
    }
  }

  assert.equal(failures.length, 0, `drop mismatches:\n  ${failures.join('\n  ')}`);
});

// ---------------------------------------------------------------------------
// 4. Invariants
// ---------------------------------------------------------------------------

test('a solved zero puts the bullet on the line of sight at the zero range', () => {
  const projectile = { ballisticCoefficient: 0.243, dragModel: 'G7' as const };
  const setup = { muzzleVelocityMs: 792.48, sightHeightMm: 38.1 };
  for (const zeroRange of [25, 100, 200, 300, 600]) {
    const angle = solveZeroAngle(projectile, setup, zeroRange);
    assert.ok(angle !== null, `no zero at ${zeroRange} m`);
    const [point] = solveTrajectory(projectile, { ...setup, launchAngleMrad: angle! }, {
      atRangesM: [zeroRange],
      maxDropM: 100,
    });
    assert.ok(
      Math.abs(point!.dropM) < 0.001,
      `zeroed at ${zeroRange} m but drop is ${point!.dropM} m`,
    );
  }
});

test('velocity and energy decay monotonically, and time of flight grows', () => {
  const projectile = { ballisticCoefficient: 0.409, dragModel: 'G1' as const, massG: 9.72 };
  const points = solveTrajectory(
    projectile,
    { muzzleVelocityMs: 886.97, launchAngleMrad: 1.48, sightHeightMm: 38.1 },
    { atRangesM: [0, 100, 200, 300, 400, 500, 600], maxDropM: 100 },
  );
  for (let i = 1; i < points.length; i += 1) {
    assert.ok(points[i]!.velocityMs < points[i - 1]!.velocityMs, 'velocity must fall');
    assert.ok(points[i]!.energyJ! < points[i - 1]!.energyJ!, 'energy must fall');
    assert.ok(points[i]!.timeS > points[i - 1]!.timeS, 'time must grow');
  }
});

test('wind moves the bullet the way the wind blows, and only then', () => {
  const projectile = { ballisticCoefficient: 0.243, dragModel: 'G7' as const };
  const setup = { muzzleVelocityMs: 792.48, launchAngleMrad: 1.17, sightHeightMm: 38.1 };
  const ranges = [500];

  const still = solveTrajectory(projectile, setup, { atRangesM: ranges, maxDropM: 100 })[0]!;
  const fromLeft = solveTrajectory(
    projectile,
    { ...setup, wind: { crossMs: 4.47, alongMs: 0 } },
    { atRangesM: ranges, maxDropM: 100 },
  )[0]!;
  const fromRight = solveTrajectory(
    projectile,
    { ...setup, wind: { crossMs: -4.47, alongMs: 0 } },
    { atRangesM: ranges, maxDropM: 100 },
  )[0]!;

  assert.ok(Math.abs(still.windageM) < 1e-9, 'no wind, no drift');
  assert.ok(fromLeft.windageM > 0.5, `a 10 mph left wind should push right, got ${fromLeft.windageM} m`);
  assert.ok(
    Math.abs(fromLeft.windageM + fromRight.windageM) < 1e-6,
    'drift must be symmetric about zero wind',
  );

  const tail = solveTrajectory(
    projectile,
    { ...setup, wind: { crossMs: 0, alongMs: 10 } },
    { atRangesM: ranges, maxDropM: 100 },
  )[0]!;
  assert.ok(tail.velocityMs > still.velocityMs, 'a tailwind reduces the air-relative speed');
});

test('a point-blank solution stays inside its own radius', () => {
  const projectile = { ballisticCoefficient: 0.409, dragModel: 'G1' as const };
  const setup = { muzzleVelocityMs: 886.97, sightHeightMm: 38.1 };
  const solution = maxPointBlankRange(projectile, setup, 0.1, 400);
  assert.ok(solution !== null, 'no point-blank solution found');
  assert.ok(solution!.maxRangeM > solution!.zeroRangeM, 'the far limit is past the zero');

  const ranges: number[] = [];
  for (let r = 0; r <= solution!.maxRangeM; r += 10) ranges.push(r);
  const points = solveTrajectory(
    projectile,
    { ...setup, launchAngleMrad: solution!.launchAngleMrad },
    { atRangesM: ranges, maxDropM: 10 },
  );
  for (const point of points) {
    assert.ok(
      Math.abs(point.dropM) <= 0.1 + 1e-6,
      `at ${point.rangeM} m the trajectory is ${point.dropM} m off, outside the 0.1 m radius it promised`,
    );
  }
});

// ---------------------------------------------------------------------------
// The drag tables themselves
// ---------------------------------------------------------------------------

test('the drag tables are ascending, positive and physically shaped', () => {
  for (const [name, table] of [['G1', G1], ['G7', G7]] as const) {
    for (let i = 1; i < table.length; i += 1) {
      assert.ok(table[i]![0] > table[i - 1]![0], `${name}: Mach must ascend at row ${i}`);
      assert.ok(table[i]![1] > 0, `${name}: drag coefficient must be positive at row ${i}`);
    }
    // Drag peaks just past Mach 1 for every standard projectile. If a table is
    // ever re-transcribed wrongly this is the shape that breaks first.
    let peakMach = 0;
    let peakCd = 0;
    for (const [mach, cd] of table) {
      if (cd > peakCd) {
        peakCd = cd;
        peakMach = mach;
      }
    }
    // Both peak transonically, but not at the same place: G7's fine boat-tail
    // shape peaks at Mach 1.05 and the blunter G1 not until Mach 1.4. The
    // window covers both, and would still catch a table transcribed with its
    // Mach column shifted or its rows out of order.
    assert.ok(
      peakMach >= 1.0 && peakMach <= 1.5,
      `${name}: drag peaks at Mach ${peakMach}, which is not the transonic rise`,
    );
  }

  // G1 is a blunter shape than G7 and must drag harder everywhere supersonic.
  for (let mach = 1.2; mach <= 4; mach += 0.2) {
    assert.ok(
      dragCoefficient('G1', mach) > dragCoefficient('G7', mach),
      `G1 should exceed G7 at Mach ${mach}`,
    );
  }
});

test('the drag curve is held, never extrapolated, outside the tabulated range', () => {
  assert.equal(dragCoefficient('G1', -5), dragCoefficient('G1', 0));
  assert.equal(dragCoefficient('G1', 99), dragCoefficient('G1', 5));
  assert.equal(dragCoefficient('G7', 99), dragCoefficient('G7', 5));
});

test('the standard atmosphere matches the ISA values every table is quoted at', () => {
  assert.ok(Math.abs(STANDARD_ATMOSPHERE.density - 1.225) < 0.0005, 'sea-level density');
  assert.ok(Math.abs(STANDARD_ATMOSPHERE.speedOfSound - 340.294) < 0.01, 'sea-level speed of sound');
  // Thinner and colder with height, in that order of obviousness.
  const high = standardAtmosphere(3000);
  assert.ok(high.density < STANDARD_ATMOSPHERE.density);
  assert.ok(high.speedOfSound < STANDARD_ATMOSPHERE.speedOfSound);
});

test('a bullet flies further in thin air than in thick', () => {
  const projectile = { ballisticCoefficient: 0.243, dragModel: 'G7' as const };
  const base = { muzzleVelocityMs: 792.48, launchAngleMrad: 1.17, sightHeightMm: 38.1 };
  const sealevel = solveTrajectory(projectile, base, { atRangesM: [800], maxDropM: 100 })[0]!;
  const altitude = solveTrajectory(
    projectile,
    { ...base, atmosphere: standardAtmosphere(3000) },
    { atRangesM: [800], maxDropM: 100 },
  )[0]!;
  assert.ok(altitude.velocityMs > sealevel.velocityMs, 'less drag at altitude');
  assert.ok(altitude.dropM > sealevel.dropM, 'and therefore less drop');
  assert.ok(mToYards(800) > 870, 'sanity on the unit helper used in this file');
});
