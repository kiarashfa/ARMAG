/**
 * Parsing for C.I.P. TDCC data — pure, so the traps are held to tests.
 *
 * Two of them are worth naming before the code, because both produce a
 * plausible wrong number rather than an error:
 *
 *  1. **A datasheet has two sections, and the same letter means different
 *     things in each.** `CARTRIDGE MAXI` describes the round; `CHAMBER MINI`
 *     describes the barrel that fires it. `R1` is 9.96 in the first and 10.00
 *     in the second on the 9 mm Luger sheet; `P1` is 9.93 and 9.96. Reading the
 *     file as one flat key/value map silently records chamber dimensions as
 *     cartridge dimensions, off by hundredths — small enough to look like a
 *     rounding difference and large enough to be wrong.
 *  2. **C.I.P. writes the comma decimal.** `19,15` is 19.15 mm, and in the
 *     index pages so is the pressure column. Parsed as English, `2.350` is not
 *     2350 bar.
 *
 * SPEC.md Appendix A governs what may be taken: **the numbers are transcribed,
 * the drawings are never republished.** These datasheets carry an explicit
 * reproduction notice covering the document; facts are not copyrightable and a
 * dozen dimensions per cartridge is extraction per entry, not bulk mirroring.
 */

/** The twelve TDCC tables, by the `cartridge_type_id` the index page takes. */
export const TDCC_TABLES = {
  1: 'I — rimless bottleneck rifle',
  2: 'II — rimmed rifle',
  3: 'III — belted rifle',
  4: 'IV — pistol and revolver',
  5: 'V — rimfire',
  6: 'VI — industrial',
  7: 'VII — shot',
  8: 'VIII — alarm and signal',
  9: 'IX — dust shot',
  10: 'X — other',
  11: 'XI — caseless',
  12: 'XII — rimfire transducer',
};

const unescapeHtml = (text) =>
  text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/**
 * C.I.P. and every European sheet write 2 350,00 or 2350,00. Never Number().
 *
 * @param {string|number|null|undefined} text
 * @returns {number|null}
 */
export function cipNumber(text) {
  if (text === null || text === undefined) return null;
  // Some values carry their unit inline (`Pmax = 2350 bar`) or a tolerance after
  // them. Take the leading numeric token and nothing else.
  const leading = /^-?[\d.,  ]+/.exec(String(text).trim());
  if (!leading) return null;
  const raw = leading[0].replace(/\s| /g, '').replace(/[.,]$/, '');
  if (!raw || !/\d/.test(raw)) return null;
  // A comma is always the decimal separator in these documents; a dot, when it
  // appears alongside one, groups thousands.
  const cleaned = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * @typedef {object} IndexRow
 * @property {string} id
 * @property {number} table
 * @property {string} name
 * @property {string|null} adopted
 * @property {string|null} revised
 * @property {string|null} country
 * @property {string|null} datasheetUrl
 * @property {number|null} pmaxBar
 */

/**
 * Rows of one TDCC index page.
 *
 * The index carries the maximum average pressure directly, which is worth
 * knowing: for a cartridge whose only C.I.P. figure you need is `maxPressure`,
 * the PDF never has to be fetched at all.
 *
 * @param {string} html
 * @param {number} tableId
 * @returns {IndexRow[]}
 */
export function parseIndex(html, tableId) {
  /** @type {IndexRow[]} */
  const rows = [];
  for (const [, id, body] of html.matchAll(/<tr id="cartridge-(\d+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 5) continue;
    const name = unescapeHtml(cells[0]);
    if (!name) continue;
    /*
     * The English datasheet is not always `…-en.pdf`. Table IV serves
     * `tabivcal-en-page28.pdf` — the language tag is in the middle — and
     * matching only the suffix silently found a datasheet for 215 of 672
     * cartridges, with 9 mm Luger among the ones it missed.
     */
    const english = [...body.matchAll(/href="(\/uploads\/tdcc\/[^"]+\.pdf)"/g)]
      .map((m) => m[1])
      .find((href) => /-en(\.pdf|-)/i.test(href));
    // The pressure columns carry a `title` attribute naming what they are, which
    // is more stable than counting columns: table IV has one fewer than table I.
    const pressure = /title="maximum average pressure \(bar\)"[^>]*>([^<]*)</.exec(body);
    rows.push({
      id,
      table: tableId,
      name,
      adopted: unescapeHtml(cells[1]) || null,
      revised: unescapeHtml(cells[2]) || null,
      country: unescapeHtml(cells[3]) || null,
      datasheetUrl: english ? `https://bobp.cip-bobp.org${english}` : null,
      pmaxBar: pressure ? cipNumber(pressure[1]) : null,
    });
  }
  return rows;
}

/**
 * Loose name matching, because nobody calls a cartridge what C.I.P. calls it.
 *
 * `9x19mm Parabellum` is `9 mm Luger` here; `.223 Remington` is `.223 Rem.`;
 * `7.62x39mm` is `7,62 x 39`. Normalising to digits-and-letters makes the
 * numeric designations match and leaves the trade names to the author.
 */
/** @param {string} name @returns {string} */
export function normaliseName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[×✕]/g, 'x')
    .replace(/,/g, '.')
    .replace(/[^a-z0-9x.]/g, '')
    // `mm` is written attached to the digits ("9x19mm"), so a word-boundary
    // strip leaves it in place and the alias table never matches.
    .replace(/mm/g, '');
}

/**
 * The cartridges C.I.P. files under a name nobody searches for.
 *
 * C.I.P. lists the *commercial* designation, and the world uses the metric or
 * military one: `9×19mm Parabellum` is filed as `9 mm Luger`, `.308 Winchester`
 * as `308 Win.`, `.380 ACP` as `9 mm Browning court`. Without this table the
 * commonest cartridges on the site return no result, and "no result" reads as
 * "C.I.P. does not standardise it" — which is a real and different answer
 * (FRICTION-LOG A4) that must not be counterfeited by a lookup failure.
 *
 * Kept deliberately short: it covers the cases where the two names share no
 * digits. Anything whose numeric designation matches already works.
 */
export const NAME_ALIASES = {
  '9x19': '9 mm Luger',
  '9mmparabellum': '9 mm Luger',
  '9x17': '9 mm Browning court',
  '380acp': '9 mm Browning court',
  '9x18': '9 mm Makarov',
  '45acp': '45 Auto',
  '308winchester': '308 Win.',
  '7.62x51': '308 Win.',
  '223remington': '223 Rem.',
  '7.62x63': '30-06 Springfield',
  '3006': '30-06 Springfield',
  '7.92x57': '8 x 57 IS',
  '8x57is': '8 x 57 IS',
  '12gauge': '12/70',
  '20gauge': '20/70',
  '.22lr': '22 Long Rifle',
  '22lr': '22 Long Rifle',
};

/**
 * Index rows matching a query, by normalised name or by the alias table.
 *
 * Containment is one-directional — the row name must contain the query, not the
 * reverse. The other direction made `9x19` match a row called `9 mm`, because
 * the normalised `9` is a substring of everything.
 *
 * @param {IndexRow[]} rows
 * @param {string} query
 * @returns {IndexRow[]}
 */
export function searchIndex(rows, query) {
  const needle = normaliseName(query);
  if (!needle) return [];
  /*
   * Try the alias table on the query and on its bare numeric designation:
   * "9×19mm Parabellum" normalises to `9x19parabellum`, and the table is keyed
   * on `9x19` because that is the part two people writing the same cartridge
   * two different ways will agree on.
   */
  const aliasKey = [needle, needle.replace(/[a-z]+$/, '')].find((key) => NAME_ALIASES[key]);
  const aliasTarget = aliasKey ? normaliseName(NAME_ALIASES[aliasKey]) : null;
  const hits = rows.filter((row) => {
    const hay = normaliseName(row.name);
    return hay.includes(needle) || (aliasTarget !== null && hay === aliasTarget);
  });
  /*
   * An exact name match outranks a substring one, and `sheet` takes the first
   * hit. Without this, ".22 Long Rifle" returned "22 Long Rifle Shot
   * Claybirding" first — it simply sits earlier in the table — and the sheet
   * command would have transcribed a shot cartridge's dimensions onto the
   * rimfire round. Found in Phase 10 on the first cartridge of the batch.
   */
  const exact = (row) =>
    normaliseName(row.name) === needle || (aliasTarget !== null && normaliseName(row.name) === aliasTarget);
  return [...hits.filter(exact), ...hits.filter((row) => !exact(row))];
}

const SECTIONS = ['CARTRIDGE MAXI', 'CHAMBER MINI'];
const SUBSECTIONS = [
  'Lengths', 'Case Head', 'Breech', 'Powder Chamber', 'Junction Cone', 'Collar',
  'Projectile', 'Commencement of Rifling', 'Barrel', 'Grooves', 'Pressures (Energies)',
  'Miscellaneous Dimensions',
];

/**
 * A datasheet's text (as PyMuPDF extracts it) into
 * `{ cartridge: {...}, chamber: {...}, meta: {...} }`.
 *
 * The layout is one token per line: a key, then `=`, then the value. Footnote
 * markers (`L3 1)`, `G1 1)*`) are part of the key line and are stripped.
 *
 * @param {string} text
 * @returns {{
 *   meta: Record<string, any>,
 *   cartridge: Record<string, { raw: string, value: number|null, subsection: string|null }>,
 *   chamber: Record<string, { raw: string, value: number|null, subsection: string|null }>,
 * }}
 */
export function parseDatasheet(text) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const out = {
    meta: {},
    cartridge: {},
    chamber: {},
  };
  let section = null;
  let subsection = null;

  // The header block, before either section starts.
  const nameLine = lines.findIndex((l) => l === 'C.I.P.');
  if (nameLine !== -1 && lines[nameLine + 1]) out.meta.name = lines[nameLine + 1];
  for (const line of lines) {
    const alt = /^Alternative Names:\s*(.+)$/.exec(line);
    if (alt) out.meta.alternativeNames = alt[1];
    const origin = /^Country of Origin:\s*(.+)$/.exec(line);
    if (origin) out.meta.countryOfOrigin = origin[1];
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (SECTIONS.includes(line)) {
      section = line === 'CARTRIDGE MAXI' ? 'cartridge' : 'chamber';
      subsection = null;
      continue;
    }
    if (SUBSECTIONS.includes(line)) {
      subsection = line;
      continue;
    }
    if (lines[i + 1] !== '=') continue;

    const key = line.replace(/\s*\d+\)/g, '').replace(/\*/g, '').trim();
    const raw = lines[i + 2];
    /*
     * A key with nothing after it means the dimension is simply not specified
     * for this cartridge — most sheets leave half of them blank. Recording it
     * as absent is the honest reading; recording zero would not be.
     *
     * The three ways "nothing after it" looks in the extracted text, and the
     * third cost a real bug: the last field of the `CARTRIDGE MAXI` block is
     * `delta L =` with no value, so the value slot holds the literal line
     * `CHAMBER MINI`. Consuming it as a value swallowed the section header, and
     * every chamber dimension was then written into the cartridge — which is
     * exactly the silent, hundredths-of-a-millimetre wrongness this module's
     * header warns about. It printed a bullet diameter of 9.05 mm for the
     * 9 mm Luger, whose real maximum is 9.03.
     */
    const hasValue =
      raw !== undefined &&
      !SECTIONS.includes(raw) &&
      !SUBSECTIONS.includes(raw) &&
      lines[i + 3] !== '=';
    if (!hasValue) {
      i += 1;
      continue;
    }
    const target = section ? out[section] : out.meta;
    // Pressures come out of the `CARTRIDGE MAXI` block but describe neither the
    // cartridge nor the chamber, so they are lifted to meta where the schema
    // expects them (`maxPressure` is a cartridge field, not a dimension).
    const bucket = subsection === 'Pressures (Energies)' ? out.meta : target;
    const numeric = cipNumber(raw);
    bucket[key] = { raw, value: numeric, subsection };
    i += 2;
  }
  return out;
}

/**
 * The C.I.P. letters mapped onto the schema's cartridge fields.
 *
 * Only the `CARTRIDGE MAXI` section maps: those are dimensions of the round.
 * Chamber dimensions are a property of the barrel and have no field here — see
 * the module header for why conflating them is the dangerous mistake.
 */
export const CARTRIDGE_DIMENSIONS = [
  { letter: 'L3', field: 'caseLength', label: 'case length' },
  { letter: 'L6', field: 'overallLength', label: 'cartridge overall length' },
  { letter: 'G1', field: 'bulletDiameter', label: 'bullet diameter' },
  { letter: 'R1', field: 'rimDiameter', label: 'rim diameter' },
  { letter: 'P1', field: 'baseDiameter', label: 'base diameter' },
  { letter: 'H2', field: 'neckDiameter', label: 'neck diameter' },
];

/** Everything else on the sheet that a reader might want, with what it means. */
export const OTHER_LETTERS = {
  R: 'rim thickness (case head)',
  E: 'extractor groove diameter',
  E1: 'extractor groove position',
  'e min': 'rim/extractor groove minimum thickness',
  'L3+G': 'case length plus bullet seating — not the overall length',
  N: 'number of grooves (chamber section — a property of the barrel)',
  u: 'rifling twist, one turn in N mm (chamber section)',
  Q: 'bore cross-sectional area, mm²',
  Pmax: 'maximum average pressure, bar → MPa is bar ÷ 10',
  PK: '1.15 × Pmax, maximum statistical individual pressure',
  PE: '1.25 × Pmax, mean proof pressure',
  M: 'location of the pressure take, mm',
};
