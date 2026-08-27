/**
 * My Armory's promises — SPEC.md §9.4 and Instruction.md Phase 7's definition
 * of done.
 *
 * Four of the five conditions are asserted here: a save survives a reload, a
 * corrupted or wrong-version blob is discarded whole, the share link contains
 * no ownership data and the backup file does, and there is no serial number
 * field anywhere. The fifth — the `/armory/` noindex triple — is asserted
 * against the built output by `check:site`, because it is a fact about `dist/`.
 */
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { armoryStateSchema, type ArmoryState } from '../../schemas/armory.ts';
import {
  addEntry,
  armoryStore,
  decodeShare,
  encodeShare,
  evictedBy,
  freeSlots,
  fromBackup,
  fromShare,
  moveEntry,
  removeEntry,
  setCapacity,
  toBackup,
  toShare,
  updateEntry,
} from './armory.ts';

const ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const withStorage = <T>(storage: unknown, run: () => T): T => {
  const previous = (globalThis as Record<string, unknown>).localStorage;
  (globalThis as Record<string, unknown>).localStorage = storage;
  try {
    return run();
  } finally {
    (globalThis as Record<string, unknown>).localStorage = previous;
  }
};

/** An armory with everything filled in — the hostile case for the share link. */
const POPULATED: ArmoryState = {
  version: 1,
  capacity: 10,
  units: 'metric',
  entries: [
    {
      uid: 'uid-a',
      gunRef: 'fixture-model-a',
      slot: 0,
      nickname: 'The old one',
      addedAt: '2024-03-02',
      ownership: {
        acquiredDate: '2024-03-01',
        acquiredPrice: 640,
        condition: 'excellent-95',
        roundCount: 4200,
        serviceIntervalRounds: 5000,
        serviceIntervalMonths: 12,
        serviceLog: [{ date: '2025-01-11', rounds: 2000, type: 'cleaning', cost: 40 }],
        valueAnchors: [{ date: '2026-01-01', value: 700 }],
      },
    },
    {
      uid: 'uid-b',
      gunRef: 'fixture-model-b',
      variantRef: 'gen-2',
      slot: 3,
      addedAt: '2025-06-04',
    },
  ],
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

test('a save survives a reload', () => {
  const storage = new FakeStorage();
  withStorage(storage, () => {
    assert.equal(armoryStore.write(POPULATED), 'ok');
  });
  // A second "page load": a fresh accessor over the same storage.
  withStorage(storage, () => {
    const result = armoryStore.read();
    assert.equal(result.outcome, 'ok');
    assert.equal(result.value?.entries.length, 2);
    assert.equal(result.value?.entries[0]?.ownership?.roundCount, 4200);
  });
});

test('a wrong-version blob is discarded whole, with a notice', () => {
  const storage = new FakeStorage();
  withStorage(storage, () => {
    storage.setItem(armoryStore.key, JSON.stringify({ v: 99, data: POPULATED }));
    const result = armoryStore.read();
    assert.equal(result.value, null);
    assert.equal(result.outcome, 'discarded-version');
    assert.ok(result.notice.length > 0);
    assert.equal(storage.getItem(armoryStore.key), null, 'the unreadable blob is removed');
  });
});

test('a corrupted blob is discarded whole rather than partially parsed', () => {
  const storage = new FakeStorage();
  withStorage(storage, () => {
    storage.setItem(armoryStore.key, '{"v":1,"data":{"version":1,"capacity":10,"entries":[{');
    const result = armoryStore.read();
    assert.equal(result.value, null);
    assert.equal(result.outcome, 'discarded-invalid');
    assert.ok(result.notice.length > 0);
  });
});

test('a blob that fails the schema is discarded, never repaired', () => {
  const storage = new FakeStorage();
  withStorage(storage, () => {
    // Two entries in bay 0. Keeping one of them would silently lose the other.
    storage.setItem(
      armoryStore.key,
      JSON.stringify({
        v: 1,
        data: {
          version: 1,
          capacity: 10,
          units: 'metric',
          entries: [
            { uid: 'a', gunRef: 'one', slot: 0, addedAt: '2026-01-01' },
            { uid: 'b', gunRef: 'two', slot: 0, addedAt: '2026-01-01' },
          ],
        },
      }),
    );
    assert.equal(armoryStore.read().outcome, 'discarded-invalid');
  });
});

// ---------------------------------------------------------------------------
// The share / backup distinction — the heart of §9.4
// ---------------------------------------------------------------------------

test('the share link contains no ownership data at all', () => {
  const share = toShare(POPULATED);
  const json = JSON.stringify(share);

  assert.ok(!json.includes('ownership'));
  for (const leak of ['640', '4200', 'excellent-95', '2024-03-01', 'The old one', '700']) {
    assert.ok(!json.includes(leak), `the share payload leaked ${leak}`);
  }
  // Nicknames are personal too, and they are not layout.
  assert.ok(!json.includes('nickname'));

  assert.deepEqual(share.entries, [
    { gunRef: 'fixture-model-a', slot: 0 },
    { gunRef: 'fixture-model-b', variantRef: 'gen-2', slot: 3 },
  ]);
});

test('the encoded share link is likewise clean', () => {
  const token = encodeShare(POPULATED);
  const decodedText = Buffer.from(
    token.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  ).toString('utf8');
  assert.ok(!decodedText.includes('ownership'));
  assert.ok(!decodedText.includes('4200'));

  const round = decodeShare(token);
  assert.deepEqual(round, toShare(POPULATED));
});

test('a share payload carrying ownership is rejected rather than stripped', () => {
  // The schema declares share entries `.strict()`, so a hand-edited link that
  // smuggles ownership fails to parse. That is the structural half of the rule;
  // `toShare` never producing one is the other half.
  const smuggled = {
    version: 1,
    capacity: 10,
    entries: [{ gunRef: 'fixture-model-a', slot: 0, ownership: { roundCount: 4200 } }],
  };
  const token = Buffer.from(JSON.stringify(smuggled), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  assert.equal(decodeShare(token), null);
});

test('an opened share link carries no ownership and no borrowed dates', () => {
  let counter = 0;
  const state = fromShare(toShare(POPULATED), '2026-08-27', () => `new-${(counter += 1)}`);
  assert.equal(state.entries.length, 2);
  for (const entry of state.entries) {
    assert.equal(entry.ownership, undefined);
    // The day the link was opened — we do not know when anyone acquired anything.
    assert.equal(entry.addedAt, '2026-08-27');
  }
  assert.equal(armoryStateSchema.safeParse(state).success, true);
});

test('the backup file DOES contain ownership, and round-trips', () => {
  const json = toBackup(POPULATED);
  assert.ok(json.includes('ownership'));
  assert.ok(json.includes('4200'));
  assert.ok(json.includes('excellent-95'));

  const restored = fromBackup(json);
  assert.deepEqual(restored, POPULATED);
});

test('a backup file from a future version restores nothing', () => {
  assert.equal(fromBackup(JSON.stringify({ ...POPULATED, version: 2 })), null);
  assert.equal(fromBackup('not json at all'), null);
});

test('a malformed share token decodes to null rather than throwing', () => {
  assert.equal(decodeShare('!!!!'), null);
  assert.equal(decodeShare(''), null);
  assert.equal(decodeShare(encodeShare(POPULATED).slice(0, 5)), null);
});

test('a share link survives a non-Latin nickname elsewhere in the armory', () => {
  // `btoa` throws above U+00FF; the encoder goes through UTF-8 first. The
  // nickname itself never travels, but the encoder still has to not throw.
  const withCyrillic: ArmoryState = {
    ...POPULATED,
    entries: [{ ...POPULATED.entries[0]!, nickname: 'Автомат' }],
  };
  assert.doesNotThrow(() => encodeShare(withCyrillic));
  assert.ok(!JSON.stringify(toShare(withCyrillic)).includes('Автомат'));
});

// ---------------------------------------------------------------------------
// Bays
// ---------------------------------------------------------------------------

test('free bays are reported in order, and a full armory says so', () => {
  assert.deepEqual(freeSlots(POPULATED), [1, 2, 4, 5, 6, 7, 8, 9]);
  const full: ArmoryState = {
    ...POPULATED,
    capacity: 10,
    entries: Array.from({ length: 10 }, (_, slot) => ({
      uid: `u${slot}`,
      gunRef: 'fixture-model-a',
      slot,
      addedAt: '2026-01-01',
    })),
  };
  assert.deepEqual(freeSlots(full), []);
  assert.equal(addEntry(full, { uid: 'x', gunRef: 'a', addedAt: '2026-01-01' }), full);
});

test('an entry lands in the first free bay unless a bay is asked for', () => {
  const added = addEntry(POPULATED, { uid: 'uid-c', gunRef: 'third', addedAt: '2026-08-27' });
  assert.equal(added.entries.find((entry) => entry.uid === 'uid-c')?.slot, 1);

  const placed = addEntry(POPULATED, {
    uid: 'uid-d',
    gunRef: 'third',
    addedAt: '2026-08-27',
    slot: 7,
  });
  assert.equal(placed.entries.find((entry) => entry.uid === 'uid-d')?.slot, 7);
});

test('the same gun may be parked twice — SPEC.md §9.4', () => {
  const twice = addEntry(POPULATED, {
    uid: 'uid-again',
    gunRef: 'fixture-model-a',
    addedAt: '2026-08-27',
  });
  assert.equal(twice.entries.filter((entry) => entry.gunRef === 'fixture-model-a').length, 2);
  assert.equal(armoryStateSchema.safeParse(twice).success, true);
});

test('moving onto an occupied bay swaps rather than overwrites', () => {
  const moved = moveEntry(POPULATED, 'uid-b', 0);
  assert.equal(moved.entries.find((entry) => entry.uid === 'uid-b')?.slot, 0);
  assert.equal(moved.entries.find((entry) => entry.uid === 'uid-a')?.slot, 3);
  assert.equal(armoryStateSchema.safeParse(moved).success, true);
});

test('removing and updating touch only the entry named', () => {
  assert.equal(removeEntry(POPULATED, 'uid-a').entries.length, 1);
  const renamed = updateEntry(POPULATED, 'uid-b', (entry) => ({ ...entry, nickname: 'Truck gun' }));
  assert.equal(renamed.entries.find((entry) => entry.uid === 'uid-b')?.nickname, 'Truck gun');
  assert.equal(renamed.entries.find((entry) => entry.uid === 'uid-a')?.nickname, 'The old one');
});

// ---------------------------------------------------------------------------
// Capacity — SPEC.md §9.4: downsizing warns before eviction
// ---------------------------------------------------------------------------

test('downsizing can be asked what it would cost before it is done', () => {
  // A bay number beyond the new capacity is NOT the same question as "what
  // would I lose", and only the second one belongs in a warning. Here bay 17
  // disappears, but bays 1 to 9 are free, so nothing is actually lost.
  const scattered: ArmoryState = {
    version: 1,
    capacity: 20,
    units: 'metric',
    entries: [
      { uid: 'low', gunRef: 'fixture-model-a', slot: 0, addedAt: '2026-01-01' },
      { uid: 'high', gunRef: 'fixture-model-b', slot: 17, addedAt: '2026-01-01' },
    ],
  };
  assert.deepEqual(evictedBy(scattered, 10), []);

  // Fill every remaining bay and there is nowhere left to put it.
  const packed: ArmoryState = {
    ...scattered,
    entries: [
      ...Array.from({ length: 10 }, (_, slot) => ({
        uid: `u${slot}`,
        gunRef: 'fixture-model-a',
        slot,
        addedAt: '2026-01-01',
      })),
      { uid: 'high', gunRef: 'fixture-model-b', slot: 17, addedAt: '2026-01-01' },
    ],
  };
  assert.deepEqual(evictedBy(packed, 10).map((entry) => entry.uid), ['high']);
});

test('an entry whose bay still exists is not moved', () => {
  // Re-picking the size you already have must not shuffle your grid.
  const same = setCapacity(POPULATED, 10);
  assert.deepEqual(same.entries.map((entry) => entry.slot), [0, 3]);

  const smaller = setCapacity({ ...POPULATED, capacity: 20 }, 10);
  assert.equal(smaller.capacity, 10);
  assert.deepEqual(smaller.entries.map((entry) => entry.slot), [0, 3]);
  assert.equal(armoryStateSchema.safeParse(smaller).success, true);
});

test('an entry whose bay has gone is rehomed into the lowest free one', () => {
  const scattered: ArmoryState = {
    version: 1,
    capacity: 20,
    units: 'metric',
    entries: [
      { uid: 'low', gunRef: 'fixture-model-a', slot: 2, addedAt: '2026-01-01' },
      { uid: 'high', gunRef: 'fixture-model-b', slot: 17, addedAt: '2026-01-01' },
    ],
  };
  const after = setCapacity(scattered, 10);
  assert.equal(after.entries.find((entry) => entry.uid === 'low')?.slot, 2, 'it still fits, so it stays');
  assert.equal(after.entries.find((entry) => entry.uid === 'high')?.slot, 0, 'its bay is gone, so it moves');
  assert.equal(armoryStateSchema.safeParse(after).success, true);
});

test('a downsize that really does not fit drops exactly what it warned about', () => {
  const many: ArmoryState = {
    version: 1,
    capacity: 20,
    units: 'metric',
    entries: Array.from({ length: 14 }, (_, slot) => ({
      uid: `u${slot}`,
      gunRef: 'fixture-model-a',
      slot,
      addedAt: '2026-01-01',
    })),
  };
  const warned = evictedBy(many, 10).map((entry) => entry.uid);
  const after = setCapacity(many, 10);
  assert.equal(after.entries.length, 10);
  assert.deepEqual(warned, ['u10', 'u11', 'u12', 'u13']);
  for (const uid of warned) {
    assert.ok(!after.entries.some((entry) => entry.uid === uid));
  }
  assert.equal(armoryStateSchema.safeParse(after).success, true);
});

// ---------------------------------------------------------------------------
// The permanent exclusion
// ---------------------------------------------------------------------------

test('no serial number field exists anywhere in the source', () => {
  // SPEC.md §9.4 and §16: not in the schema, not in the backup, not in the
  // share link, not in a comment that someone might later take as a to-do. A
  // leaked save must never be a theft shopping list.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.(ts|astro|svelte|mjs|json)$/.test(entry.name) ? [full] : [];
    });

  const offenders: string[] = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    if (file.endsWith(path.join('storage', 'armory.test.ts'))) continue;
    const source = readFileSync(file, 'utf8');
    // The identifier, in the shapes a field could take. Prose in a comment
    // explaining the absence uses "serial number", with a space, and is fine —
    // the site has to be able to say why the field is not there.
    if (/\bserialNumber\b|['"]serial['"]|\bserial_number\b/.test(source)) {
      offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], 'a serial number identifier has appeared');
  assert.ok(statSync(path.join(ROOT, 'src', 'schemas', 'armory.ts')).size > 0);
});
