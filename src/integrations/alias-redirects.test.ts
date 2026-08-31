import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { redirectsFor, slugifyAlias } from './alias-redirects.ts';

test('an alias becomes a URL-safe slug', () => {
  assert.equal(slugifyAlias('Light Fifty'), 'light-fifty');
  assert.equal(slugifyAlias('Carbine, Caliber 5.56 mm, M4'), 'carbine-caliber-5-56-mm-m4');
  assert.equal(slugifyAlias('.45 ACP'), '45-acp');
});

test('the redirect carries the base path on the target but not on the route', () => {
  const map = redirectsFor('guns', [{ id: 'barrett-m82', aliases: ['M107'] }], '/ARMAG');
  assert.deepEqual(map, { '/guns/m107/': '/ARMAG/guns/barrett-m82/' });
});

test('an alias that is already an entry id mints no redirect', () => {
  // The AR-15 family entry lists "AR-15" as an alias of itself. A redirect
  // there would shadow the real page with a redirect to itself.
  const map = redirectsFor('guns', [{ id: 'ar-15', aliases: ['AR-15', 'MSR'] }]);
  assert.deepEqual(Object.keys(map), ['/guns/msr/']);
});

test('an alias two entries both claim mints no redirect', () => {
  const map = redirectsFor('guns', [
    { id: 'colt-m4-carbine', aliases: ['Model 11'] },
    { id: 'browning-auto-5', aliases: ['Model 11'] },
  ]);
  assert.deepEqual(map, {});
});

test('one entry listing the same alias twice is not a collision', () => {
  const map = redirectsFor('guns', [{ id: 'glock-17', aliases: ['P80', 'P-80'] }]);
  assert.deepEqual(map, { '/guns/p80/': '/guns/glock-17/', '/guns/p-80/': '/guns/glock-17/' });
});

test('an alias that slugifies to nothing is dropped rather than minting /guns//', () => {
  assert.deepEqual(redirectsFor('guns', [{ id: 'pkm', aliases: ['—'] }]), {});
});
