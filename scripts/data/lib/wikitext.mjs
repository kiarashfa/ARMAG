/**
 * Wikitext parsing for the authoring pipeline.
 *
 * Ported from Markey's `lib/wikitext.mjs`. The template machinery
 * (`splitTopLevel`, `parseConvert`, `fieldValues`, `parseLocalisedNumber`) is
 * domain-neutral and shipped, so it is kept verbatim; what changed for ARMAG is
 * the unit table, the glossary, the infobox selector, and one addition.
 *
 * **The addition is `fieldReferences()`, and it is the point of this file.**
 * SPEC.md Appendix A says a Wikipedia infobox is "a first pass only — never the
 * last word", and the Phase 8 friction log (A2) found that the actually
 * authoritative sources — `FM 3-22.9`, `TM 43-0001-27` — are usually already
 * cited in the infobox line you are reading. Stripping the `<ref>` tags before
 * showing the author the figure throws away the citation that would let them
 * record it honestly. So refs are stripped from the *value* and returned
 * *beside* it.
 *
 * Pure functions over strings — no I/O, no network — so the awkward cases are
 * held to tests rather than to an author's memory.
 */

/** Strips `<ref>…</ref>`, self-closing refs and HTML comments. */
export function stripRefs(text) {
  return text
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Splits on a template's top-level `|`, ignoring pipes nested inside `{{}}`,
 * `[[]]` or `<>`. Naive splitting on `|` is the single most common way to
 * mangle an infobox, because `{{convert|1|-|2|kg}}` is full of them.
 */
export function splitTopLevel(body, separator = '|') {
  const parts = [];
  let depth = 0;
  let link = 0;
  let angle = 0;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      if (two === '{{') depth += 1;
      else link += 1;
      current += two;
      i += 1;
      continue;
    }
    if (two === '}}' || two === ']]') {
      if (two === '}}') depth -= 1;
      else link -= 1;
      current += two;
      i += 1;
      continue;
    }
    const ch = body[i];
    if (ch === '<') angle += 1;
    if (ch === '>') angle = Math.max(0, angle - 1);
    if (ch === separator && depth === 0 && link === 0 && angle === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** Finds a balanced `{{…}}` starting at `start`, returning its full text. */
function balancedTemplate(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text.startsWith('{{', i)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (text.startsWith('}}', i)) {
      depth -= 1;
      i += 1;
      if (depth === 0) return text.slice(start, i + 1);
      continue;
    }
  }
  return null;
}

/** Every `{{Infobox …}}` on the page, in document order. */
export function infoboxes(wikitext) {
  const found = [];
  const pattern = /\{\{\s*infobox/gi;
  let match;
  while ((match = pattern.exec(wikitext)) !== null) {
    const template = balancedTemplate(wikitext, match.index);
    if (template) {
      found.push(template);
      pattern.lastIndex = match.index + template.length;
    }
  }
  return found;
}

/**
 * The arms infobox, whichever template name the article uses.
 *
 * `{{Infobox weapon}}` covers nearly everything in scope, but a cartridge
 * article uses `{{Infobox firearm cartridge}}` — a different template with
 * `case_type`, `bullet`, `bw1`/`vel1`/`en1` load rows and no `weight` at all.
 * Matching only `Infobox weapon` silently returns nothing for every cartridge,
 * which is half the collections this site has.
 */
export function armsInfobox(wikitext) {
  const all = infoboxes(wikitext);
  return (
    all.find((box) =>
      /\{\{\s*infobox\s+(weapon|firearm cartridge|firearm|gun|ammunition)/i.test(box),
    ) ??
    all[0] ??
    null
  );
}

/** Which infobox template a block is, lowercased — the caller renders differently per kind. */
export function infoboxName(infoboxText) {
  const match = /^\{\{\s*(infobox[^|\n}]*)/i.exec((infoboxText ?? '').trim());
  return match ? match[1].trim().toLowerCase().replace(/\s+/g, ' ') : null;
}

/** Parses an infobox into `{ field: rawValue }`, refs and comments removed. */
export function infoboxFields(infoboxText) {
  if (!infoboxText) return {};
  const inner = infoboxText.replace(/^\{\{/, '').replace(/\}\}$/, '');
  const parts = splitTopLevel(inner);
  /** @type {Record<string, string>} */
  const fields = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = stripRefs(part.slice(eq + 1)).trim();
    if (key) fields[key] = value;
  }
  return fields;
}

/**
 * The citations attached to one infobox field, as URLs and as raw ref text.
 *
 * See the module header. `weight = {{convert|3.47|kg}}<ref>{{cite book …}}</ref>`
 * carries the real source of the figure inside the tag `infoboxFields` throws
 * away, and that source is very often a manual or a manufacturer sheet — i.e.
 * something that can carry a `verified` status, where the Wikipedia article
 * alone is a first pass.
 *
 * Returns `{ urls, titles, raw }`. Named refs (`<ref name="k3" />`) resolve to
 * nothing here on purpose: the definition lives elsewhere in the article and
 * pretending otherwise would invent a citation.
 */
export function fieldReferences(infoboxText, name) {
  if (!infoboxText) return { urls: [], titles: [], raw: [] };
  const inner = infoboxText.replace(/^\{\{/, '').replace(/\}\}$/, '');
  for (const part of splitTopLevel(inner).slice(1)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim().toLowerCase() !== name.toLowerCase()) continue;
    const body = part.slice(eq + 1);
    const raw = [...body.matchAll(/<ref[^>]*>([\s\S]*?)<\/ref>/gi)].map((m) => m[1].trim());
    const urls = [...body.matchAll(/\|\s*url\s*=\s*([^|}\s]+)/gi)].map((m) => m[1]);
    const titles = [...body.matchAll(/\|\s*title\s*=\s*([^|}]+)/gi)].map((m) => m[1].trim());
    return { urls, titles, raw };
  }
  return { urls: [], titles: [], raw: [] };
}

/**
 * Unwraps a `{{convert}}` / `{{cvt}}` into the value(s) **as published**.
 *
 * The subtlety that matters: the *first* unit is the source unit, and for arms
 * it is imperial about half the time. `{{convert|16|in|mm|0}}` means the
 * publisher wrote 16 inches and Wikipedia rendered the millimetres. Recording
 * 406.4 mm is right, but the `sourceNote` must say it was published in inches
 * — which is why this returns the source unit rather than silently normalising.
 */
export function parseConvert(template) {
  const match = /^\{\{\s*(convert|cvt)\s*\|([\s\S]*)\}\}$/i.exec(template.trim());
  if (!match) return null;
  const args = splitTopLevel(match[2]).map((a) => a.trim());
  const positional = args.filter((a) => !a.includes('='));
  if (positional.length === 0) return null;

  const values = [];
  let index = 0;
  const asNumber = (raw) => {
    const cleaned = (raw ?? '').replace(/,/g, '').replace(/&nbsp;/g, '').trim();
    return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
  };

  const first = asNumber(positional[index]);
  if (first === null) return null;
  values.push(first);
  index += 1;

  if (index < positional.length && /^(-|–|to|and|x|×|by)$/i.test(positional[index])) {
    index += 1;
    const second = asNumber(positional[index]);
    if (second !== null) {
      values.push(second);
      index += 1;
    }
  }

  const unit = positional[index] ?? null;
  const target = positional[index + 1] ?? null;
  return { values, unit, target: target && !/^\d+$/.test(target) ? target : null };
}

/**
 * Finds the first `{{convert}}`/`{{cvt}}` embedded anywhere in a string, and
 * keeps the prose around it.
 *
 * An arms infobox value is almost never a bare template. The AK-47's `length`
 * reads `Fixed wooden stock:<br />{{convert|880|mm}}` and the M4's `weight`
 * distinguishes "empty" from "with 30 rounds". That prose is not noise — it is
 * the difference between two figures that are both correct — so it is returned
 * as the qualifier rather than discarded.
 */
export function extractConvert(text) {
  const match = /\{\{\s*(convert|cvt)\s*\|/i.exec(text);
  if (!match) return null;
  const template = balancedTemplate(text, match.index);
  if (!template) return null;
  const parsed = parseConvert(template);
  if (!parsed) return null;
  const qualifier = plain(
    `${text.slice(0, match.index)} ${text.slice(match.index + template.length)}`,
  )
    .replace(/^[\s,;:]+|[\s,;:]+$/g, '')
    .trim();
  return { ...parsed, qualifier: qualifier.length > 0 ? qualifier : null };
}

/**
 * A bare number with a unit, where there is no `{{convert}}` at all.
 *
 * Arms infoboxes are much less disciplined about `{{convert}}` than car ones:
 * the AK-47 writes its cyclic rate as plain `600 rounds/min` and the sight
 * graduations as `100–800&nbsp;m`. Without this the densest lines on the page
 * parse to nothing.
 */
export function extractBareQuantity(text) {
  const clean = plain(text);
  const pattern =
    /(-?\d[\d,]*(?:\.\d+)?)\s*(?:[–-]\s*(\d[\d,]*(?:\.\d+)?)\s*)?(mm|cm|m|in|inch(?:es)?|ft|kg|g|gr(?:ain)?s?|lb|lbs|oz|m\/s|ft\/s|fps|rpm|rounds?\/min|rds\/min|J|ft·lbf|ft-lbs?|psi|MPa|bar)\b/gi;
  const num = (raw) => Number(String(raw).replace(/,/g, ''));

  for (const match of clean.matchAll(pattern)) {
    /*
     * A cartridge designation is not a measurement, and this is where that
     * mistake would be made silently. `7.62×39mm` parses as "39 mm" and would
     * be offered to the author as a length; so would the `45` in `.45 ACP`.
     * The tell is always the character immediately before the digits — a
     * multiplication sign, a leading decimal point, a slash or another digit
     * means this number is part of a name, not a quantity.
     */
    const before = clean.slice(0, match.index).replace(/\s+$/, '').slice(-1);
    if (before && /[×x.·\/\d]/i.test(before)) continue;

    const values = [num(match[1])];
    if (match[2] !== undefined) values.push(num(match[2]));
    const qualifier = `${clean.slice(0, match.index)} ${clean.slice(match.index + match[0].length)}`
      .replace(/[\s,;:]+/g, ' ')
      .trim();
    return { values, unit: match[3], target: null, qualifier: qualifier || null };
  }
  return null;
}

/** Strips wiki markup from a plain string: links, bold/italics, entities. */
export function plain(text) {
  return stripRefs(text)
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\{\{\s*(efn|sfnp|sfn|citation needed|page needed)[^}]*\}\}/gi, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Splits a field into the separate values it actually holds.
 *
 * `{{ubl}}`, `{{unbulleted list}}`, `{{plainlist}}` and bare `<br />` all mean
 * "this field has several values". Every arm in the pilot batch used at least
 * one of them; the AK-47 uses `<br />` for four different overall lengths.
 */
export function fieldValues(raw) {
  if (!raw) return [];
  const listMatch =
    /^\{\{\s*(ubl|unbulleted list|plainlist|plain list|hlist)\s*\|([\s\S]*)\}\}$/i.exec(raw.trim());
  const body = listMatch ? listMatch[2] : raw;
  const parts = listMatch
    ? splitTopLevel(body).filter((p) => !p.includes('='))
    : splitTopLevel(body, '\n').flatMap((line) => line.split(/<br\s*\/?>/i));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Reads one infobox field into structured values.
 *
 * Each item is `{ raw, text, qualifier, values, unit, target, bare }`. `bare`
 * marks a figure recovered by `extractBareQuantity` rather than from a
 * `{{convert}}` — a distinction the author needs, because a bare number has
 * had no template-level unit checking at all.
 */
export function readField(fields, name) {
  const raw = fields[name];
  if (!raw) return [];
  return fieldValues(raw).map((entry) => {
    const converted = extractConvert(entry);
    const fallback = converted ? null : extractBareQuantity(entry);
    const found = converted ?? fallback;
    return {
      raw: entry,
      text: plain(entry),
      qualifier: found?.qualifier ?? null,
      values: found?.values ?? null,
      unit: found?.unit ?? null,
      target: found?.target ?? null,
      bare: Boolean(fallback),
    };
  });
}

/**
 * Unit conversions to the SI units `siUnit` actually stores (primitives.ts).
 *
 * Grains are here because they are the unit every bullet mass in the English
 * literature is published in, and 1 gr = 0.06479891 g exactly. `ft·lbf` and
 * `psi` likewise: US ammunition tables publish energy in foot-pounds and SAAMI
 * publishes pressure in psi, while C.I.P. publishes the same pressure in bar.
 * Both convert to the stored MPa, and the factor goes in the note.
 */
export const TO_SI = {
  // length → mm
  mm: { factor: 1, unit: 'mm' },
  cm: { factor: 10, unit: 'mm' },
  in: { factor: 25.4, unit: 'mm' },
  inch: { factor: 25.4, unit: 'mm' },
  inches: { factor: 25.4, unit: 'mm' },
  ft: { factor: 304.8, unit: 'mm' },
  // range-scale length → m
  m: { factor: 1, unit: 'm' },
  yd: { factor: 0.9144, unit: 'm' },
  // mass → g / kg
  g: { factor: 1, unit: 'g' },
  gr: { factor: 0.06479891, unit: 'g' },
  grain: { factor: 0.06479891, unit: 'g' },
  grains: { factor: 0.06479891, unit: 'g' },
  oz: { factor: 28.349523125, unit: 'g' },
  kg: { factor: 1, unit: 'kg' },
  lb: { factor: 0.45359237, unit: 'kg' },
  lbs: { factor: 0.45359237, unit: 'kg' },
  // velocity → m/s
  'm/s': { factor: 1, unit: 'm/s' },
  'ft/s': { factor: 0.3048, unit: 'm/s' },
  fps: { factor: 0.3048, unit: 'm/s' },
  // energy → J
  J: { factor: 1, unit: 'J' },
  'ft·lbf': { factor: 1.3558179483314004, unit: 'J' },
  'ft-lb': { factor: 1.3558179483314004, unit: 'J' },
  'ft-lbs': { factor: 1.3558179483314004, unit: 'J' },
  ftlbf: { factor: 1.3558179483314004, unit: 'J' },
  // force → N
  N: { factor: 1, unit: 'N' },
  lbf: { factor: 4.4482216152605, unit: 'N' },
  // pressure → MPa
  MPa: { factor: 1, unit: 'MPa' },
  bar: { factor: 0.1, unit: 'MPa' },
  psi: { factor: 0.00689475729316836, unit: 'MPa' },
  // rate → rpm
  rpm: { factor: 1, unit: 'rpm' },
  'rounds/min': { factor: 1, unit: 'rpm' },
  'rounds/minute': { factor: 1, unit: 'rpm' },
  'rds/min': { factor: 1, unit: 'rpm' },
};

/**
 * Converts a published figure to the SI unit the schema stores, reporting the
 * factor so it can be written into `sourceNote`.
 *
 * The project rule is that a converted number states what it was converted
 * from and by what — an unexplained 406.4 mm looks like a measurement, and it
 * is a rendering of 16 inches.
 */
export function toSi(value, unit) {
  const rule = TO_SI[unit] ?? TO_SI[String(unit ?? '').toLowerCase()];
  if (!rule) return null;
  return {
    value: value * rule.factor,
    unit: rule.unit,
    factor: rule.factor,
    note:
      rule.factor === 1
        ? null
        : `Published as ${value} ${unit}, converted at 1 ${unit} = ${rule.factor} ${rule.unit}.`,
  };
}

// ---------------------------------------------------------------------------
// Reading numbers written in another language's convention
// ---------------------------------------------------------------------------

/** Languages that write 1.234,5 rather than 1,234.5. */
export const COMMA_DECIMAL_LANGS = new Set([
  'de', 'ru', 'fr', 'it', 'nl', 'es', 'pt', 'pl', 'cs', 'sv', 'da', 'fi', 'tr',
]);

/**
 * Parses a number that may be written in a European convention.
 *
 * The single most dangerous thing about sourcing from a non-English Wikipedia:
 * German writes one thousand two hundred as `1.200`, and read as English that
 * is 1.2. A muzzle velocity off by a factor of a thousand looks absurd to a
 * human and completely ordinary to a validator — it is a number, it is
 * positive, the schema accepts it. C.I.P.'s own datasheets use the comma
 * decimal too (`19,15` mm), so this is not a rare path here.
 *
 * So this never guesses. `1.234,5` is unambiguous and parses. `1.234` is
 * genuinely ambiguous and comes back flagged, with the reason, for a person.
 */
export function parseLocalisedNumber(text, lang = 'en') {
  if (text === null || text === undefined) return null;
  const raw = String(text).trim().replace(/ |&nbsp;/g, ' ').replace(/\s+/g, '');
  if (!/^[+-]?[\d.,]+$/.test(raw) || !/\d/.test(raw)) return null;

  const commas = (raw.match(/,/g) ?? []).length;
  const dots = (raw.match(/\./g) ?? []).length;
  const commaDecimal = COMMA_DECIMAL_LANGS.has(lang);

  if (commas > 0 && dots > 0) {
    const decimalIsComma = raw.lastIndexOf(',') > raw.lastIndexOf('.');
    const cleaned = decimalIsComma
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
    return { value: Number(cleaned), ambiguous: false, note: null };
  }

  const only = commas > 0 ? ',' : dots > 0 ? '.' : null;
  if (!only) return { value: Number(raw), ambiguous: false, note: null };

  const parts = raw.split(only);
  const tail = parts[parts.length - 1];

  if (parts.length > 2) {
    return { value: Number(raw.split(only).join('')), ambiguous: false, note: null };
  }
  if (tail.length === 3) {
    const asThousands = Number(parts.join(''));
    const asDecimal = Number(`${parts[0]}.${tail}`);
    const separatorIsDecimalHere = (only === ',') === commaDecimal;
    return {
      value: separatorIsDecimalHere ? asDecimal : asThousands,
      ambiguous: true,
      note:
        `"${text}" is ambiguous: ${asThousands} if "${only}" groups thousands, ` +
        `${asDecimal} if it is a decimal separator. Read as ${separatorIsDecimalHere ? asDecimal : asThousands} ` +
        `for lang "${lang}" — confirm against the source before recording it.`,
    };
  }
  return { value: Number(`${parts[0]}.${tail}`), ambiguous: false, note: null };
}

/**
 * Spec-table terms in the languages that hold the best arms sources, where a
 * confident misreading is silent.
 *
 * Russian and German earn their place: the Kalashnikov and Mauser literature is
 * primary-source in those languages, and `Начальная скорость` (muzzle velocity)
 * against `Прицельная дальность` (sight-graduated range) is exactly the pair an
 * agent will conflate, producing a plausible number in the wrong field.
 */
export const GLOSSARY = {
  ru: {
    'Масса': 'mass — check whether with or without magazine (с магазином / без магазина)',
    'без магазина': 'WITHOUT magazine — this is massEmpty',
    'с магазином': 'WITH magazine — NOT massEmpty',
    'Длина': 'overall length',
    'Длина ствола': 'barrel length',
    'Начальная скорость': 'muzzle velocity, m/s',
    'Прицельная дальность': 'sight-graduated range — NOT effective range, and NOT velocity',
    'Темп стрельбы': 'cyclic rate, rounds/min',
    'Боевая скорострельность': 'PRACTICAL rate of fire — not the cyclic rate',
    'Патрон': 'cartridge',
    'Ёмкость магазина': 'magazine capacity',
    'Калибр': 'calibre',
  },
  de: {
    Gewicht: 'mass — check whether loaded (geladen) or empty (ungeladen)',
    Gesamtlänge: 'overall length',
    Lauflänge: 'barrel length',
    Kaliber: 'calibre',
    'Mündungsgeschwindigkeit': 'muzzle velocity, m/s',
    Kadenz: 'cyclic rate, rounds/min',
    Feuerarten: 'fire modes',
    Magazin: 'magazine',
    Visierlänge: 'sight radius',
    Drall: 'rifling twist — usually given as one turn in N mm',
  },
  fr: {
    Masse: 'mass',
    'Longueur totale': 'overall length',
    'Longueur du canon': 'barrel length',
    'Vitesse initiale': 'muzzle velocity, m/s',
    'Cadence de tir': 'cyclic rate, rounds/min',
  },
};
