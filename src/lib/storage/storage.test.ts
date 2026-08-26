/**
 * The storage wrapper's promises, asserted — SPEC.md §9.9.
 *
 * The interesting cases are all failures: a browser that refuses, a blob from
 * an older schema version, and a damaged blob. Each must be discarded whole and
 * reported, because a half-read saved state is worse for a reader than a
 * cleared one.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { compareTrayStore, defineStore } from './index.ts';

// Written out longhand: Node's type-stripping runs TypeScript without
// transforming it, and a constructor parameter property is syntax rather than
// a type annotation, so it is one of the few things it refuses.
class FakeStorage {
  private map = new Map<string, string>();
  private blocked: boolean;
  constructor(blocked = false) {
    this.blocked = blocked;
  }
  getItem(key: string): string | null {
    if (this.blocked) throw new Error('blocked');
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.blocked) throw new Error('blocked');
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    if (this.blocked) throw new Error('blocked');
    this.map.delete(key);
  }
  raw(key: string): string | undefined {
    return this.map.get(key);
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

test('keys are namespaced, so nothing else on the origin is ours to read', () => {
  assert.equal(compareTrayStore.key, 'armag:compare-tray');
});

test('a value survives a write and a read', () => {
  const storage = new FakeStorage();
  withStorage(storage, () => {
    assert.equal(compareTrayStore.write([{ id: 'fixture-model-a', name: 'Fixture Model A' }]), 'ok');
    const result = compareTrayStore.read();
    assert.deepEqual(result.value, [{ id: 'fixture-model-a', name: 'Fixture Model A' }]);
    assert.equal(result.outcome, 'ok');
    assert.equal(result.notice, '');
  });
});

test('an unrecognised version is discarded whole, not partially parsed', () => {
  const storage = new FakeStorage();
  withStorage(storage, () => {
    storage.setItem(
      compareTrayStore.key,
      JSON.stringify({ v: 99, data: [{ id: 'fixture-model-a', name: 'A' }] }),
    );
    const result = compareTrayStore.read();
    assert.equal(result.value, null);
    assert.equal(result.outcome, 'discarded-version');
    assert.ok(result.notice.length > 0, 'a discarded blob must produce a notice for the reader');
    assert.equal(storage.raw(compareTrayStore.key), undefined, 'the bad blob must be removed');
  });
});

test('a damaged blob is discarded and reported', () => {
  const storage = new FakeStorage();
  withStorage(storage, () => {
    storage.setItem(compareTrayStore.key, '{not json');
    const result = compareTrayStore.read();
    assert.equal(result.outcome, 'discarded-invalid');
    assert.equal(storage.raw(compareTrayStore.key), undefined);
  });
});

test('a blob that fails its schema check is discarded, never repaired', () => {
  const storage = new FakeStorage();
  withStorage(storage, () => {
    // A plausible-looking entry with a missing name: repairing it would put an
    // item in the tray that the reader never added.
    storage.setItem(compareTrayStore.key, JSON.stringify({ v: 1, data: [{ id: 'a-slug' }] }));
    assert.equal(compareTrayStore.read().outcome, 'discarded-invalid');
  });
});

test('a browser that refuses storage reports it rather than throwing', () => {
  withStorage(new FakeStorage(true), () => {
    const result = compareTrayStore.read();
    assert.equal(result.outcome, 'unavailable');
    assert.ok(result.notice.includes('remembered'));
    assert.equal(compareTrayStore.write([]), 'unavailable');
  });
});

test('no storage at all is not an error', () => {
  withStorage(undefined, () => {
    assert.equal(compareTrayStore.read().outcome, 'unavailable');
  });
});

test('the tray is capped at four, per SPEC.md §9.2', () => {
  const storage = new FakeStorage();
  withStorage(storage, () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `entry-${i}`, name: `Entry ${i}` }));
    compareTrayStore.write(many);
    assert.equal(compareTrayStore.read().value?.length, 4);
  });
});

test('two stores of the same name but different versions do not read each other', () => {
  const storage = new FakeStorage();
  withStorage(storage, () => {
    const v1 = defineStore<number>('probe', 1, (raw) => (typeof raw === 'number' ? raw : null));
    const v2 = defineStore<number>('probe', 2, (raw) => (typeof raw === 'number' ? raw : null));
    v1.write(42);
    assert.equal(v2.read().outcome, 'discarded-version');
    assert.equal(v1.read().value, null, 'the discard is destructive by design');
  });
});
