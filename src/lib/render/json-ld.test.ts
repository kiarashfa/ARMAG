import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  breadcrumbList,
  commerceViolations,
  definedTerm,
  entryArticle,
  itemList,
  serialize,
} from './json-ld.ts';

const absolute = (path: string) => `https://kiarashfa.github.io${path}`;

test('the commerce ban catches a forbidden @type anywhere in the tree', () => {
  const found = commerceViolations({
    '@type': 'TechArticle',
    mainEntity: { '@type': 'Product', name: 'Glock 17' },
  });
  assert.equal(found.length, 1);
  assert.match(found[0]!, /Product/);
});

test('the commerce ban catches a price property, however it is nested', () => {
  const found = commerceViolations({
    '@type': 'TechArticle',
    extra: [{ deeper: { price: 599 } }],
  });
  assert.equal(found.length, 1);
  assert.match(found[0]!, /price/);
});

test('an array-valued @type is checked element by element', () => {
  const found = commerceViolations({ '@type': ['TechArticle', 'Offer'] });
  assert.equal(found.length, 1);
  assert.match(found[0]!, /Offer/);
});

test('serialize refuses to emit commerce markup at all', () => {
  assert.throws(
    () => serialize({ '@type': 'Product', name: 'Glock 17' }),
    /SPEC\.md §12 forbids/,
  );
});

test('serialize escapes < so a name cannot close the script element', () => {
  const json = serialize({ '@type': 'TechArticle', name: 'a</script><b>' });
  assert.ok(!json.includes('</script>'));
  assert.ok(json.includes('\\u003c/script'));
  // Still valid JSON, and still the same string once parsed.
  assert.equal((JSON.parse(json) as { name: string }).name, 'a</script><b>');
});

test('the last breadcrumb is the current page and carries no item', () => {
  const node = breadcrumbList(
    [
      { label: 'ARMAG', path: '/ARMAG/' },
      { label: 'Firearms', path: '/ARMAG/guns/' },
      { label: 'Glock 17' },
    ],
    absolute,
  );
  const items = node.itemListElement as Record<string, unknown>[];
  assert.equal(items.length, 3);
  assert.equal(items[0]!.item, 'https://kiarashfa.github.io/ARMAG/');
  assert.equal(items[2]!.name, 'Glock 17');
  assert.equal('item' in items[2]!, false);
  assert.deepEqual(
    items.map((i) => i.position),
    [1, 2, 3],
  );
});

test('an entry article drops absent fields rather than emitting nulls', () => {
  const node = entryArticle({
    type: 'TechArticle',
    name: 'Glock 17',
    description: 'A striker-fired pistol.',
    url: 'https://example.test/guns/glock-17/',
  });
  assert.equal('image' in node, false);
  assert.equal('dateModified' in node, false);
  assert.equal(node['@type'], 'TechArticle');
  assert.equal(node.isAccessibleForFree, true);
});

test('an entry below the publication floor is listed by name with no url', () => {
  const node = itemList('Revolvers', [
    { name: 'Colt Single Action Army', url: 'https://example.test/guns/colt-saa/' },
    { name: 'Intratec TEC-9' },
  ]);
  const items = node.itemListElement as Record<string, unknown>[];
  assert.equal(node.numberOfItems, 2);
  assert.equal('url' in items[1]!, false);
});

test('a glossary term declares the set it belongs to', () => {
  const node = definedTerm({
    term: 'Bullpup',
    description: 'Action behind the trigger.',
    url: 'https://example.test/glossary/bullpup/',
    setUrl: 'https://example.test/glossary/',
  });
  assert.equal(node['@type'], 'DefinedTerm');
  assert.equal(
    (node.inDefinedTermSet as Record<string, unknown>).url,
    'https://example.test/glossary/',
  );
});
