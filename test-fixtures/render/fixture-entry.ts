/**
 * The render fixture — Instruction.md Phase 4's "hand-written fixture entry".
 *
 * ── Why this is not in `src/content/` ──────────────────────────────────────
 * A fictional firearm sitting in the real content collection would render as a
 * real page and would be fabricated data of exactly the kind SPEC.md exists to
 * prevent. This lives in `test-fixtures/`, is imported only by a dev-only route
 * that emits nothing in a production build, and is deleted by nobody because it
 * keeps earning its place: it is the only entry on the site that exercises
 * **all four trust statuses at once**.
 *
 * That is what it is for. Real entries are mostly verified and occasionally
 * blank; this one deliberately carries a verified figure with a live source
 * link, an estimated figure with its basis, a `conflicting-sources` figure, and
 * a `placeholder` that blocks a derived calculation downstream — so every path
 * through `FigureValue`, `SpecRow` and `StatusBadge` is visible on one screen.
 *
 * Images are inline SVG data URIs. `assetUrl()` passes those through untouched,
 * so the harness needs no files in `public/` and nothing here can ever be
 * mistaken for a photograph of a real arm.
 */
import type { CartridgeData } from '../../src/schemas/cartridge.ts';
import type { GunData } from '../../src/schemas/gun.ts';
import type { MakerData } from '../../src/schemas/maker.ts';

const SOURCE = 'https://example.org/fixture-source';

const placeholderImage = (label: string, tint: string): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="${tint}"/><text x="600" y="410" font-family="sans-serif" font-size="56" fill="#888" text-anchor="middle">${label}</text></svg>`,
  )}`;

const image = (label: string, tint: string, alt: string) => ({
  src: placeholderImage(label, tint),
  alt,
  caption: `${label} — a placeholder shape, not a photograph.`,
  width: 1200,
  height: 800,
  credit: {
    author: 'ARMAG render fixture',
    sourceUrl: SOURCE,
    title: label,
    licenseType: 'cc0' as const,
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
});

/**
 * Generic over the unit so the literal type survives: `propertyValue('mm')`
 * pins the unit per field, and a helper returning `unit: string` would defeat
 * exactly the check that stops a velocity in feet per second reaching a solver
 * expecting metres.
 */
const verified = <U extends string>(value: number, unit: U, source = 'fixture-manual') => ({
  value,
  unit,
  status: 'verified' as const,
  source,
  sourceUrl: SOURCE,
});

const estimated = <U extends string>(value: number, unit: U, note: string) => ({
  value,
  unit,
  status: 'estimated' as const,
  sourceNote: note,
});

export const FIXTURE_MAKER: MakerData = {
  id: 'fixture-arms',
  name: 'Fixture Arms',
  nativeName: 'Фикстура',
  country: 'austria',
  founded: 1963,
  dissolved: null,
  website: 'https://example.org/fixture-arms',
  lastVerified: '2026-08-26',
  reviewStatus: 'draft',
  references: [
    {
      key: 'fixture-manual',
      type: 'manufacturer-spec',
      title: 'Fixture Arms product specification sheet',
      publisher: 'Fixture Arms',
      url: SOURCE,
      year: 2024,
      accessed: '2026-08-26',
    },
  ],
};

export const FIXTURE_CARTRIDGE: CartridgeData = {
  id: 'fixture-9mm',
  name: '9×19mm Fixture',
  aliases: [
    { name: '9mm Fixture', kind: 'commercial' },
    { name: '9×19 FX', kind: 'military' },
  ],
  designedBy: 'Fixture Ordnance Board',
  introduced: 1902,
  standard: 'cip',
  caseType: 'rimless',
  caseShape: 'tapered',
  bulletDiameter: verified(9.03, 'mm', 'fixture-cip'),
  caseLength: verified(19.15, 'mm', 'fixture-cip'),
  overallLength: verified(29.69, 'mm', 'fixture-cip'),
  maxPressure: verified(235, 'MPa', 'fixture-cip'),
  pressureStandard: 'cip',
  loads: [
    {
      id: 'fixture-115-fmj',
      name: '115 gr FMJ',
      manufacturer: 'Fixture Ammunition',
      bulletMass: verified(7.45, 'g', 'fixture-cip'),
      cartridgeMass: verified(12.0, 'g', 'fixture-cip'),
      bulletType: 'FMJ',
      bcG1: estimated(0.14, '', 'Typical for a 115 gr round-nose profile; not published for this load.'),
      velocityByBarrel: [
        { barrelLength: verified(102, 'mm', 'fixture-cip'), velocity: verified(340, 'm/s', 'fixture-cip') },
        { barrelLength: verified(127, 'mm', 'fixture-cip'), velocity: verified(360, 'm/s', 'fixture-cip') },
        { barrelLength: verified(152, 'mm', 'fixture-cip'), velocity: verified(375, 'm/s', 'fixture-cip') },
      ],
    },
  ],
  images: [],
  lastVerified: '2026-08-26',
  reviewStatus: 'draft',
  references: [
    {
      key: 'fixture-cip',
      type: 'standards-body',
      title: 'C.I.P. TDCC datasheet, 9×19mm Fixture',
      publisher: 'C.I.P.',
      url: SOURCE,
      revision: 'TDCC 2024-01',
      accessed: '2026-08-26',
    },
  ],
};

export const FIXTURE_GUN: GunData = {
  id: 'fixture-model-a',
  name: 'Fixture Model A',
  kind: 'model',
  nativeName: 'Фикстура Модель А',
  makerRef: 'fixture-arms',
  familyRef: null,
  alsoInFamilies: [],

  aliases: [
    { name: 'M9 Fixture', kind: 'military', market: 'US', years: { start: 1985, end: 2017 } },
    { name: 'FX-A', kind: 'export' },
  ],
  lineage: {},

  type: 'pistol',
  action: 'self-loading',
  fireModes: ['semi'],
  operatingSystem: 'short-recoil',
  feedSystem: ['detachable-box'],
  roles: ['duty-sidearm', 'concealed-carry'],

  designedIn: 'austria',
  producedIn: ['austria', 'united-states'],
  introduced: 1982,
  productionYears: { start: 1982, end: null },

  // Mass and dimensions — one of each status, on purpose.
  massEmpty: verified(0.625, 'kg'),
  massMagazineEmpty: estimated(0.07, 'kg', 'Weighed from a published photograph scale bar; not a manufacturer figure.'),
  length: verified(186, 'mm'),
  width: verified(30, 'mm'),
  height: verified(138, 'mm'),
  barrelLength: verified(114, 'mm'),

  sightRadius: verified(165, 'mm'),
  sightHeightOverBore: estimated(32, 'mm', 'Measured from the manufacturer drawing, which is dimensioned but not to this point.'),
  riflingTwist: verified(250, 'mm'),
  twistDirection: 'right',
  riflingGrooves: 6,

  // The blocked path: no sourced figure, so every derived value that needs it
  // renders as an honest gap naming this input rather than being estimated.
  cyclicRate: { value: null, unit: 'rpm', status: 'placeholder' },
  // The fourth status, which nothing else on the site would otherwise show.
  triggerPull: {
    value: 24.5,
    unit: 'N',
    status: 'conflicting-sources',
    source: 'fixture-manual',
    sourceUrl: SOURCE,
    sourceNote: 'The manual states 24.5 N; an independent test report measured 28 N on the same variant.',
  },
  effectiveRange: verified(50, 'm'),

  chamberings: [{ cartridgeRef: 'fixture-9mm', capacity: verified(17, ''), primary: true }],

  variants: [
    {
      id: 'gen-1',
      name: 'First generation',
      productionYears: { start: 1982, end: 1988 },
      summary: 'The original pattern, with a smooth frontstrap and no accessory rail.',
      overrides: { massEmpty: verified(0.618, 'kg') },
      configurations: [],
    },
    {
      id: 'gen-2',
      name: 'Second generation',
      productionYears: { start: 1988, end: 1997 },
      summary: 'Checkered frontstrap and a revised extractor. Same envelope.',
      overrides: {
        massEmpty: verified(0.625, 'kg'),
        barrelLength: verified(114, 'mm'),
      },
      configurations: [
        {
          id: 'gen-2-compact',
          name: 'Compact',
          overrides: { barrelLength: verified(102, 'mm'), length: verified(174, 'mm') },
        },
      ],
    },
    {
      id: 'gen-3',
      name: 'Third generation',
      productionYears: { start: 1998, end: null },
      summary: 'Accessory rail and an ambidextrous magazine catch.',
      overrides: { massEmpty: verified(0.638, 'kg'), width: verified(32, 'mm') },
      configurations: [],
    },
  ],

  fits: [
    { standard: 'rail', value: 'MIL-STD-1913' },
    { standard: 'muzzle-thread', value: '1/2×28' },
  ],

  productionTotal: estimated(2400000, '', 'Sum of the annual figures published between 1985 and 2020; the years before 1985 are not published.'),

  images: [
    image('Right profile', '#2a2f38', 'Right side profile of the Fixture Model A, a placeholder shape'),
    image('Left profile', '#333944', 'Left side profile of the Fixture Model A, a placeholder shape'),
    image('Field stripped', '#3a4048', 'The Fixture Model A field stripped, a placeholder shape'),
  ],

  lastVerified: '2026-08-26',
  reviewStatus: 'draft',
  references: [
    {
      key: 'fixture-manual',
      type: 'manufacturer-spec',
      title: 'Fixture Arms Model A operator manual',
      publisher: 'Fixture Arms',
      url: SOURCE,
      year: 2019,
      accessed: '2026-08-26',
    },
    {
      key: 'fixture-tm',
      type: 'military-manual',
      title: 'Operator manual, pistol, 9 mm, M9 Fixture',
      publisher: 'Department of the Army',
      revision: 'TM 9-1005-317-10',
      accessed: '2026-08-26',
      license: 'public domain',
    },
  ],
};
