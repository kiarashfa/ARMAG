/**
 * The registry's teeth — Instruction.md Phase 6's definition of done.
 *
 * *"Adding a field to `gun.ts` makes it appear in both the spec table and the
 * compare table without any other edit. Verify that by actually adding a
 * throwaway field and removing it."*
 *
 * That verification was done by hand once, on a real build. These tests are so
 * it stays true: the throwaway field is added here, to a copy of the schema, on
 * every run.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { gunDataSchema } from '../../schemas/gun.ts';
import { propertyValue, siUnit } from '../../schemas/primitives.ts';
import { figuresForGun, GUN_FIGURES } from '../content/derived.ts';
import { FIXTURE_CARTRIDGE, FIXTURE_GUN } from '../../../test-fixtures/render/fixture-entry.ts';
import { buildCompareEntry, buildPopulations } from './entry.ts';
import {
  CARTRIDGE_REGISTRY,
  GUN_COMPARE_ROWS,
  GUN_REGISTRY,
  groupRows,
  GUN_GROUP_ORDER,
  labelFromKey,
  registryFrom,
} from './rows.ts';

const ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const read = (relative: string): string => readFileSync(path.join(ROOT, relative), 'utf8');

test('every schema field is classified — no field is silently dropped', () => {
  assert.deepEqual(
    GUN_REGISTRY.unclassified,
    [],
    `gun.ts has fields the registry cannot render. Either give them a row kind in registryFrom(), or name them in GUN_SKIP with the reason: ${GUN_REGISTRY.unclassified.join(', ')}`,
  );
  assert.deepEqual(CARTRIDGE_REGISTRY.unclassified, []);
});

test('no skip exemption outlives the field it exempts', () => {
  // A renamed field leaving a stale exemption behind would silently suppress a
  // row that should now appear — the exact failure the registry exists to stop.
  assert.deepEqual(GUN_REGISTRY.staleSkips, []);
  assert.deepEqual(CARTRIDGE_REGISTRY.staleSkips, []);
});

test('a new schema field becomes a row with no other edit', () => {
  const extended = gunDataSchema.extend({
    throwawayClearance: propertyValue('mm').optional(),
  });
  const registry = registryFrom(extended, { skip: {}, groups: {} });
  const row = registry.rows.find((candidate) => candidate.key === 'throwawayClearance');

  assert.ok(row, 'a propertyValue field added to the schema did not produce a row');
  assert.equal(row.kind, 'scalar');
  // The unit is read off the z.literal the schema pins, not typed a second time.
  assert.equal(row.unit, 'mm');
  assert.equal(row.numeric, true);
  // Unnamed and ungrouped, it still renders legibly rather than as a raw key.
  assert.equal(row.label, 'Throwaway clearance');
  assert.equal(row.group, 'Other specifications');
  assert.ok(GUN_GROUP_ORDER.includes(row.group), 'the fallback group must be in the group order');
});

test('every scalar row carries a unit the schema knows', () => {
  const units = new Set(siUnit.options as readonly string[]);
  for (const row of [...GUN_REGISTRY.rows, ...CARTRIDGE_REGISTRY.rows]) {
    if (row.kind !== 'scalar') continue;
    assert.ok(units.has(row.unit ?? ''), `row ${row.key} has non-SI unit ${row.unit}`);
  }
});

test('row keys are unique across the whole compare table', () => {
  const keys = GUN_COMPARE_ROWS.map((row) => row.key);
  assert.equal(new Set(keys).size, keys.length, 'a duplicate key would overwrite a cell');
});

test('every declared derived figure is actually produced', () => {
  const figures = figuresForGun(FIXTURE_GUN, FIXTURE_CARTRIDGE);
  for (const declared of GUN_FIGURES) {
    assert.ok(
      declared.key in figures.byKey,
      `GUN_FIGURES declares '${declared.key}' but figuresForGun does not produce it`,
    );
    assert.equal(figures.byKey[declared.key]!.unit, declared.unit, `unit mismatch on ${declared.key}`);
  }
  assert.equal(
    Object.keys(figures.byKey).length,
    GUN_FIGURES.length,
    'figuresForGun produced a figure that GUN_FIGURES does not declare, so it would never reach the compare table',
  );
  assert.equal(figures.statStrip.length, 5, 'SPEC.md §11 wants a five-number stat strip');
});

test('every row reads a cell off the fixture, and none is undefined', () => {
  const entry = buildCompareEntry(GUN_COMPARE_ROWS, FIXTURE_GUN, {
    cartridge: FIXTURE_CARTRIDGE,
  });
  for (const row of GUN_COMPARE_ROWS) {
    const cell = entry.cells[row.key];
    assert.ok(cell, `no cell for row ${row.key}`);
    assert.equal(cell.kind, row.kind, `cell kind disagrees with the row for ${row.key}`);
  }
});

test('a blocked derived figure names its missing input rather than guessing', () => {
  // The fixture's cyclic rate is a placeholder, which must block the magazine
  // dump instead of being estimated from something else.
  const entry = buildCompareEntry(GUN_COMPARE_ROWS, FIXTURE_GUN, { cartridge: FIXTURE_CARTRIDGE });
  const cell = entry.cells['magazine-dump'];
  assert.equal(cell?.kind, 'derived');
  if (cell.kind !== 'derived') return;
  assert.equal(cell.derived.value, null);
  assert.ok(cell.derived.blockedBy, 'a blocked figure must say which input blocked it');
});

test('the percentile a cell carries names its population', () => {
  const bare = buildCompareEntry(GUN_COMPARE_ROWS, FIXTURE_GUN, { cartridge: FIXTURE_CARTRIDGE });
  const populations = buildPopulations(GUN_COMPARE_ROWS, [
    { type: bare.type, cells: bare.cells },
    { type: bare.type, cells: bare.cells },
  ]);
  const entry = buildCompareEntry(GUN_COMPARE_ROWS, FIXTURE_GUN, {
    cartridge: FIXTURE_CARTRIDGE,
    populations,
  });
  const cell = entry.cells.massEmpty;
  assert.equal(cell?.kind, 'scalar');
  if (cell.kind !== 'scalar') return;
  assert.ok(cell.percentile, 'a numeric cell in a population should carry its position');
  assert.equal(cell.percentile.populationSize, 2);
  // Two entries, four members short of MIN_TYPED_POPULATION, so the honest set
  // is everything rather than "2nd of 2 pistols".
  assert.equal(cell.percentile.setLabel, 'all entries');
});

test('a value with no figure carries no percentile', () => {
  const entry = buildCompareEntry(GUN_COMPARE_ROWS, FIXTURE_GUN, {
    cartridge: FIXTURE_CARTRIDGE,
    populations: buildPopulations(GUN_COMPARE_ROWS, []),
  });
  const cell = entry.cells.cyclicRate;
  assert.equal(cell?.kind, 'scalar');
  if (cell.kind !== 'scalar') return;
  assert.equal(cell.value, null);
  assert.equal(cell.percentile, undefined);
});

test('grouping keeps the stated order and drops empty groups', () => {
  const grouped = groupRows(GUN_COMPARE_ROWS, GUN_GROUP_ORDER);
  const names = grouped.map((bucket) => bucket.group);
  assert.equal(names[0], 'Derived figures', 'the computed layer leads, per SPEC.md §11');
  assert.ok(!names.includes('Other specifications'), 'no field is currently ungrouped');
  const ranks = names.map((name) => GUN_GROUP_ORDER.indexOf(name));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test('labelFromKey turns a camelCase field into a sentence', () => {
  assert.equal(labelFromKey('barrelLength'), 'Barrel length');
  assert.equal(labelFromKey('sightHeightOverBore'), 'Sight height over bore');
  assert.equal(labelFromKey('riflingTwist'), 'Rifling twist');
});

test('the spec table and the compare table are driven by the same registry', () => {
  // The registry is worthless if either consumer quietly reads fields directly.
  // A hand-written `gun.massEmpty` in the template is exactly the regression
  // this asserts against, and it is invisible to `astro check`.
  const specTable = read('src/components/blocks/SpecTable.astro');
  assert.match(specTable, /rows: readonly CompareRow\[\]/, 'the spec table must take rows, not fields');

  const gunPage = read('src/components/templates/GunPage.astro');
  assert.match(gunPage, /rows=\{GUN_REGISTRY\.rows\}/);
  for (const field of ['gun.massEmpty', 'gun.barrelLength', 'gun.cyclicRate', 'gun.sightRadius']) {
    assert.ok(
      !gunPage.includes(field),
      `GunPage reads ${field} directly — spec rows must come from the registry`,
    );
  }

  const comparePage = read('src/pages/compare/index.astro');
  assert.match(comparePage, /GUN_COMPARE_ROWS/);
});

test('nothing in the compare layer ranks entries against each other', () => {
  // SPEC.md §9.2: no "winner" badges. Lighter is better for carry and worse for
  // recoil; the site does not know what the reader wants. The prose says so on
  // the page, and no identifier here computes one.
  const tool = read('src/components/islands/CompareTool.svelte');
  assert.match(tool, /No column is marked as the winner/);

  for (const file of [
    'src/lib/compare/rows.ts',
    'src/lib/compare/entry.ts',
    'src/components/islands/CompareTool.svelte',
  ]) {
    for (const banned of ['isWinner', 'winnerOf', 'isBest', 'bestOf', 'rankEntries', 'betterThan']) {
      assert.ok(!read(file).includes(banned), `${file} contains '${banned}'`);
    }
  }
});
