/**
 * Vocabulary invariants — SPEC.md §7.
 *
 * The taxonomy files are plain JSON, so nothing but this stops a term being
 * added with a capitalised id, a duplicate of an existing one, or an accent
 * that no design token backs. Each of those fails late and quietly: an invalid
 * id becomes a 404 taxonomy URL, and an unbacked accent becomes an element
 * styled with `var(--color-type-…)` that resolves to nothing and inherits
 * whatever was behind it.
 *
 * The era assertions matter for a different reason: era is COMPUTED, so a gap
 * between two buckets is not a wrong answer, it is an entry that silently
 * belongs to no era and disappears from that browse axis entirely.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  accentForType,
  AUTHORED_VOCABULARIES,
  countries,
  eraForYear,
  eras,
  types,
  type CountryTerm,
} from './taxonomy.ts';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

test('every vocabulary has unique, kebab-case, labelled terms', () => {
  const failures: string[] = [];
  for (const [axis, vocab] of Object.entries(AUTHORED_VOCABULARIES)) {
    if (vocab.terms.length === 0) failures.push(`${axis}: no terms`);
    const seen = new Set<string>();
    for (const term of vocab.terms) {
      if (!KEBAB.test(term.id)) failures.push(`${axis}: id '${term.id}' is not kebab-case`);
      if (seen.has(term.id)) failures.push(`${axis}: duplicate id '${term.id}'`);
      seen.add(term.id);
      if (!term.label || term.label.trim() === '') failures.push(`${axis}: '${term.id}' has no label`);
    }
  }
  assert.equal(failures.length, 0, failures.join('\n  '));
});

test('every firearm type names a content accent that global.css defines', () => {
  const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
  const failures: string[] = [];
  const used = new Set<string>();
  for (const term of types.terms) {
    used.add(term.accent);
    for (const token of [`--color-type-${term.accent}:`, `--color-type-${term.accent}-surface:`]) {
      if (!css.includes(token)) {
        failures.push(`type '${term.id}' uses accent '${term.accent}', but ${token} is not in global.css`);
      }
    }
  }
  // `platform` belongs to `kind: 'family'` entries, which have no type at all,
  // so it is the one accent that legitimately appears in no type term.
  assert.equal(accentForType(null), 'platform');
  assert.equal(accentForType('not-a-type'), 'platform');
  assert.ok(used.size >= 5, `only ${used.size} accents are used by any type`);
  assert.equal(failures.length, 0, failures.join('\n  '));
});

test('era buckets are contiguous — no year belongs to two eras or to none', () => {
  const sorted = [...eras.terms].sort((a, b) => a.start - b.start);
  assert.deepEqual(
    sorted.map((e) => e.id),
    eras.terms.map((e) => e.id),
    'eras.json must be written in chronological order — the browse axis renders in file order',
  );

  const failures: string[] = [];
  for (const era of sorted) {
    if (era.end < era.start) failures.push(`${era.id}: ends before it starts`);
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;
    if (current.start !== previous.end + 1) {
      failures.push(
        `${previous.id} ends ${previous.end} but ${current.id} starts ${current.start} — ${current.start > previous.end + 1 ? 'the years between belong to no era' : 'the overlap makes era ambiguous'}`,
      );
    }
  }
  assert.equal(failures.length, 0, failures.join('\n  '));
});

test('eraForYear resolves at the boundaries and only inside the covered range', () => {
  const first = eras.terms[0]!;
  const last = eras.terms[eras.terms.length - 1]!;
  assert.equal(eraForYear(first.start), first.id);
  assert.equal(eraForYear(first.end), first.id);
  assert.equal(eraForYear(last.start), last.id);
  assert.equal(eraForYear(first.start - 1), null, 'before the metallic cartridge is out of scope');
  for (const era of eras.terms) {
    assert.equal(eraForYear(era.start), era.id);
    assert.equal(eraForYear(era.end), era.id);
  }
});

test('every historical state has an end date and a successor that exists', () => {
  const ids = new Set(countries.terms.map((c) => c.id));
  const failures: string[] = [];
  for (const country of countries.terms as CountryTerm[]) {
    if (country.succeededBy && !ids.has(country.succeededBy)) {
      failures.push(`${country.id}: succeededBy '${country.succeededBy}' is not a listed country`);
    }
    if (country.existed && !country.succeededBy) {
      failures.push(
        `${country.id}: has an end date but no successor — a reader browsing forward from a dissolved state hits a dead end`,
      );
    }
    if (country.succeededBy === country.id) failures.push(`${country.id}: succeeds itself`);
  }
  assert.equal(failures.length, 0, failures.join('\n  '));
});
