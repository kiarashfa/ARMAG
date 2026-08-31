import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  entryIdFromPath,
  findStandalone,
  linkTree,
  resolveTargets,
  urlFor,
  type HastNode,
  type LinkTarget,
} from './rehype-crosslink.ts';
import { readGlossaryFrontmatter } from './rehype-glossary.ts';

const entry = (id: string, name: string): LinkTarget => ({
  id,
  name,
  url: `/ARMAG/guns/${id}/`,
  kind: 'entry',
});

const paragraph = (text: string): HastNode => ({
  type: 'root',
  children: [{ type: 'element', tagName: 'p', children: [{ type: 'text', value: text }] }],
});

/** Every anchor in a tree, as `[text, href, kind]`. */
function anchors(node: HastNode): [string, string, string][] {
  const out: [string, string, string][] = [];
  const visit = (n: HastNode): void => {
    if (n.tagName === 'a') {
      out.push([
        (n.children?.[0]?.value ?? '') as string,
        String(n.properties?.href ?? ''),
        String(n.properties?.['data-crosslink'] ?? ''),
      ]);
      return;
    }
    for (const child of n.children ?? []) visit(child);
  };
  visit(node);
  return out;
}

test('a name is not matched inside a longer word', () => {
  assert.equal(findStandalone('the AK-47M is different', 'AK-47'), -1);
  assert.equal(findStandalone('the AK-47 is not', 'AK-47'), 4);
});

test('a name ending in punctuation still matches at a boundary', () => {
  assert.equal(findStandalone('chambered in .45 ACP, which', '.45 ACP'), 13);
});

test('case-insensitive matching finds a term at the start of a sentence', () => {
  assert.equal(findStandalone('Bullpup layouts are odd', 'bullpup', true), 0);
});

test('the longest name wins, so the specific entry claims the text', () => {
  const targets = resolveTargets([entry('m16', 'M16 rifle'), entry('m16a2', 'M16 rifle A2')]);
  const tree = paragraph('The M16 rifle A2 replaced it.');
  linkTree(tree, targets, null);
  assert.deepEqual(
    anchors(tree).map(([text]) => text),
    ['M16 rifle A2'],
  );
});

test('a name two entries both claim links to neither', () => {
  const targets = resolveTargets([
    { ...entry('colt-m4', 'M4 carbine') },
    { ...entry('other-m4', 'M4 carbine') },
  ]);
  assert.deepEqual(targets, []);
});

test('only the first mention of each entry is linked', () => {
  const tree = paragraph('The Type 56 is a Type 56, after all.');
  linkTree(tree, resolveTargets([entry('type-56', 'Type 56')]), null);
  assert.equal(anchors(tree).length, 1);
});

test('an entry never links to itself', () => {
  const tree = paragraph('The Type 56 was made at Norinco.');
  linkTree(tree, resolveTargets([entry('type-56', 'Type 56')]), 'type-56');
  assert.equal(anchors(tree).length, 0);
});

test('nothing inside a heading, a link or code becomes a link', () => {
  for (const tagName of ['h2', 'a', 'code']) {
    const tree: HastNode = {
      type: 'root',
      children: [{ type: 'element', tagName, children: [{ type: 'text', value: 'The Type 56.' }] }],
    };
    linkTree(tree, resolveTargets([entry('type-56', 'Type 56')]), null);
    assert.equal(anchors(tree).length, tagName === 'a' ? 1 : 0, tagName);
    // The `a` case counts the pre-existing anchor, not a new one.
    if (tagName === 'a') assert.equal(anchors(tree)[0]![1], '');
  }
});

test('a two-character alias is below the minimum length and is dropped', () => {
  assert.deepEqual(resolveTargets([entry('ak-47', 'AK')]), []);
});

test('a case-insensitive match keeps the casing the author wrote', () => {
  const target: LinkTarget = {
    id: 'bullpup',
    name: 'bullpup',
    url: '/ARMAG/glossary/bullpup/',
    title: 'Action behind the trigger.',
    kind: 'glossary',
  };
  const tree = paragraph('Bullpup rifles are shorter.');
  linkTree(tree, [target], null, { caseInsensitive: true });
  assert.deepEqual(anchors(tree), [['Bullpup', '/ARMAG/glossary/bullpup/', 'glossary']]);
});

test('a shared `used` set stops the glossary re-linking what an entry already claimed', () => {
  const tree = paragraph('The Type 56 and the Type 56 again.');
  const used = linkTree(tree, resolveTargets([entry('type-56', 'Type 56')]), null);
  linkTree(tree, [{ id: 'type-56', name: 'type 56', url: '/x/', kind: 'glossary' }], null, {
    caseInsensitive: true,
    used,
  });
  assert.equal(anchors(tree).length, 1);
});

test('urls carry the base path and always end in a slash', () => {
  assert.equal(urlFor('/ARMAG', 'guns', 'glock-17'), '/ARMAG/guns/glock-17/');
  assert.equal(urlFor('/', 'glossary', 'bullpup'), '/glossary/bullpup/');
});

test('the self id comes from the content path, not the collection name', () => {
  assert.equal(entryIdFromPath('/repo/src/content/guns/glock-17.mdx'), 'glock-17');
  assert.equal(entryIdFromPath('C:\\repo\\src\\content\\cartridges\\9x19mm.mdx'), '9x19mm');
  assert.equal(entryIdFromPath(undefined), null);
});

test('glossary frontmatter yields the term, its definition and its aka list', () => {
  const parsed = readGlossaryFrontmatter(
    ['---', 'id: open-bolt', 'term: "Open bolt"', 'short: "Fires from the rear."', 'aka:', '  - open-bolt firing', '  - "advanced primer ignition"', '---', '', 'Body text.'].join('\n'),
  );
  assert.equal(parsed?.term, 'Open bolt');
  assert.equal(parsed?.id, 'open-bolt');
  assert.equal(parsed?.short, 'Fires from the rear.');
  assert.deepEqual(parsed?.aka, ['open-bolt firing', 'advanced primer ignition']);
});

test('a name with no letter in it is dropped — the year 1911 is not a pistol', () => {
  // Found in the first real build: "service rifle cartridge from 1911 until
  // the 1990s" linked the year to the M1911, on a page about a Swiss round.
  assert.deepEqual(resolveTargets([entry('m1911-pistol', '1911')]), []);
  // A designation that merely contains digits is still linkable.
  assert.equal(resolveTargets([entry('m16-rifle', 'M16A2')]).length, 1);
});
