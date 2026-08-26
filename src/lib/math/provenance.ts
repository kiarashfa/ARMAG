/**
 * Status propagation and the input chain — SPEC.md §8.4.
 *
 * This module is the reason the derived layer is trustworthy rather than
 * decorative. Every function in `lib/math` that produces a number for a reader
 * returns it through `derive()`, so three things are true of every figure on
 * the site without anyone having to remember them:
 *
 *  1. **A derived value inherits the worst status among its inputs.** Estimated
 *     in, estimated out — rendered with a dashed curve and an amber badge
 *     rather than quietly presented as measurement.
 *  2. **A `placeholder` input blocks computation entirely.** `null` is not a
 *     number, and there is no defensible value to substitute for one.
 *  3. **The input chain travels with the value.** The ƒ panel can show the
 *     formula, each input with its own value and source link, and the
 *     assumptions — which is what makes "the reader can open it and check"
 *     a fact rather than a claim.
 *
 * The anti-fabrication incentive lives elsewhere, in the completeness score
 * (SPEC.md §5.9): only `verified` values count toward it, so estimating your
 * way to a full page produces a Tier 3 entry covered in amber badges.
 * Inventing numbers buys nothing.
 *
 * Pure. No DOM, no I/O, no framework import.
 */

export type ValueStatus = 'verified' | 'estimated' | 'placeholder' | 'conflicting-sources';

/**
 * Best to worst.
 *
 * `conflicting-sources` ranks below `estimated` deliberately. An estimate is
 * one number we chose and can explain; conflicting sources means the published
 * record itself disagrees, which is the stronger warning to a reader and should
 * win when both are in the same calculation. `placeholder` is last because it
 * is not a status so much as the absence of a value.
 */
export const STATUS_ORDER: readonly ValueStatus[] = [
  'verified',
  'estimated',
  'conflicting-sources',
  'placeholder',
];

const RANK = new Map<ValueStatus, number>(STATUS_ORDER.map((s, i) => [s, i]));

/** The worst status in a set. No inputs means nothing was assumed: verified. */
export function worstStatus(...statuses: ValueStatus[]): ValueStatus {
  let worst: ValueStatus = 'verified';
  for (const status of statuses) {
    if ((RANK.get(status) ?? 0) > (RANK.get(worst) ?? 0)) worst = status;
  }
  return worst;
}

/** The minimum a `PropertyValue` must look like for this module to use it. */
export interface ValueLike {
  value: number | null;
  unit?: string;
  status: ValueStatus;
  source?: string;
  sourceUrl?: string;
  sourceNote?: string;
}

/** One input as it appears in the ƒ panel, with its own provenance intact. */
export interface InputRef {
  /** How the input is named in the formula, e.g. 'm' or 'muzzle velocity'. */
  label: string;
  value: number | null;
  unit: string;
  status: ValueStatus;
  source?: string;
  sourceUrl?: string;
  sourceNote?: string;
}

export interface Derived<T = number> {
  /** `null` when an input blocked the computation. */
  value: T | null;
  status: ValueStatus;
  unit: string;
  /** Human-readable, shown at the top of the ƒ panel. */
  formula: string;
  inputs: InputRef[];
  /** Anything the formula takes for granted, stated so a reader can disagree. */
  assumptions: string[];
  /**
   * Set when the value is `null` because an input had no number. Names the
   * input, so the page can say *which* missing figure is why this is blank —
   * SPEC.md §2 principle 6: a missing figure says so.
   */
  blockedBy?: string;
}

export interface DeriveSpec<T> {
  formula: string;
  unit: string;
  inputs: { label: string; of: ValueLike; unit?: string }[];
  assumptions?: string[];
  /** Receives the input values in order, all guaranteed non-null. */
  compute: (values: number[]) => T;
  /**
   * Raised above the inputs' own worst status when the model itself is the
   * weak link — an interpolated velocity, say, or a recoil figure computed
   * without the propellant term. Never lowers it.
   */
  modelStatus?: ValueStatus;
}

/**
 * Runs a calculation and wraps the result with everything a reader needs to
 * check it.
 *
 * The order of `inputs` is the order `compute` receives them in. That coupling
 * is deliberate: it means the ƒ panel lists exactly the values the formula
 * consumed, in the order the formula names them, and cannot drift into showing
 * a citation for a number the calculation never used.
 */
export function derive<T>(spec: DeriveSpec<T>): Derived<T> {
  const inputs: InputRef[] = spec.inputs.map((input) => ({
    label: input.label,
    value: input.of.value,
    unit: input.unit ?? input.of.unit ?? '',
    status: input.of.status,
    source: input.of.source,
    sourceUrl: input.of.sourceUrl,
    sourceNote: input.of.sourceNote,
  }));

  const assumptions = spec.assumptions ?? [];
  const blocking = inputs.find((input) => input.value === null);

  if (blocking) {
    return {
      value: null,
      status: 'placeholder',
      unit: spec.unit,
      formula: spec.formula,
      inputs,
      assumptions,
      blockedBy: blocking.label,
    };
  }

  const status = worstStatus(
    ...inputs.map((input) => input.status),
    ...(spec.modelStatus ? [spec.modelStatus] : []),
  );

  return {
    value: spec.compute(inputs.map((input) => input.value as number)),
    status,
    unit: spec.unit,
    formula: spec.formula,
    inputs,
    assumptions,
  };
}

/**
 * A number that came from nowhere but a constant or a caller's own input — a
 * user-entered figure in a calculator, a defined quantity such as standard
 * gravity.
 *
 * `verified` is right for these: a defined constant is not an estimate, and a
 * figure the reader typed is theirs rather than ours. What it must never be
 * used for is a number read off a source, which needs a real citation.
 */
export const given = (value: number | null, unit = '', note?: string): ValueLike => ({
  value,
  unit,
  status: 'verified',
  sourceNote: note,
});

/** True when a derived value has a number a caller can use. */
export function hasValue<T>(derived: Derived<T>): derived is Derived<T> & { value: T } {
  return derived.value !== null;
}

/**
 * Re-wraps a derived value as an input to a further calculation, so a chain of
 * three formulas still shows one honest status at the end.
 */
export function asInput<T extends number>(derived: Derived<T>): ValueLike {
  return {
    value: derived.value,
    unit: derived.unit,
    status: derived.status,
    sourceNote: derived.formula,
  };
}
