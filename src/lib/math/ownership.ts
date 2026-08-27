/**
 * Ownership arithmetic — SPEC.md §9.4.
 *
 * *"Owned entries additionally get service due/overdue computed from the user's
 * own intervals, a burn-rate projection from logged sessions, and a value
 * estimate = condition grade × user-supplied base."*
 *
 * A module SPEC.md §8.1's table does not name, added here because those three
 * computations have to live somewhere pure and testable, and putting them in an
 * island would make the one part of the site that handles a visitor's own
 * records the one part with untested arithmetic in it.
 *
 * ── Everything here runs on the owner's numbers, not ours ──────────────────
 * The site never invents a service interval. A wrong one is either a false
 * alarm or a false all-clear, and neither is ours to issue — so every function
 * below returns `null` rather than a default when the owner has not set the
 * figure it needs. That is the same rule as the rest of `lib/math`: a missing
 * input blocks the computation instead of being substituted.
 *
 * Pure. No DOM, no I/O, no framework import. `today` is always a parameter,
 * never `Date.now()`, because a function that reads the clock cannot be tested
 * and cannot be re-run to the same answer.
 */
import { conditionAdjustedValue, type NraConditionGrade } from './economics.ts';
import { derive, given, type Derived, type ValueLike } from './provenance.ts';

/** Only the fields these computations read. Keeps the module free of the schema. */
export interface OwnershipFacts {
  acquiredDate?: string;
  acquiredPrice?: number;
  condition?: NraConditionGrade;
  roundCount?: number;
  serviceIntervalRounds?: number;
  serviceIntervalMonths?: number;
  serviceLog: readonly { date: string; rounds?: number; type: string; cost?: number }[];
  valueAnchors: readonly { date: string; value: number }[];
}

/** Whole days between two ISO dates. Negative when `to` precedes `from`. */
export function daysBetween(from: string, to: string): number | null {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

/**
 * The average Gregorian month, used to turn a months interval into days.
 *
 * Calendar months are 28 to 31 days long, so "six months from the 31st" has no
 * single correct answer. A stated average keeps the arithmetic reversible and
 * the error under two days across a year — which is well inside the precision
 * of "your rifle is about due".
 */
export const DAYS_PER_MONTH = 30.436875;

export const addMonths = (isoDate: string, months: number): string | null => {
  const base = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(base)) return null;
  return new Date(base + months * DAYS_PER_MONTH * 86_400_000).toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ServiceStatus {
  /** The most recent service of any kind, or the acquisition date. */
  since: string;
  /** Set when the owner recorded a round interval and a round count. */
  roundsRemaining: number | null;
  /** Set when the owner recorded a month interval. Negative means overdue. */
  daysRemaining: number | null;
  nextDueDate: string | null;
  overdue: boolean;
  /**
   * Which interval is closest to expiring, so the UI shows one line rather than
   * two competing ones. `null` when the owner has set no interval at all.
   */
  governedBy: 'rounds' | 'time' | null;
  /** What the answer rests on, in the owner's own terms. Never empty. */
  basis: string[];
}

/**
 * When the arm is next due for service, on the owner's own intervals.
 *
 * Returns `null` when no interval is set — which is the common case and is not
 * a problem to be solved by inventing one. The UI says the owner has not set an
 * interval, and offers to let them.
 */
export function serviceStatus(
  ownership: OwnershipFacts,
  today: string,
): ServiceStatus | null {
  const hasRounds = ownership.serviceIntervalRounds !== undefined;
  const hasMonths = ownership.serviceIntervalMonths !== undefined;
  if (!hasRounds && !hasMonths) return null;

  const sorted = [...ownership.serviceLog].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const since = last?.date ?? ownership.acquiredDate ?? null;
  if (since === null) return null;

  const basis: string[] = [
    last
      ? `Measured from the last logged service on ${last.date}.`
      : `Measured from the acquisition date, ${since}: nothing has been logged yet.`,
  ];

  // Rounds since service. A service entry that recorded the round count at the
  // time is what makes this exact; without one, the whole round count is used
  // and the basis line says so.
  let roundsRemaining: number | null = null;
  if (hasRounds && ownership.roundCount !== undefined) {
    const atLastService = last?.rounds;
    const fired = ownership.roundCount - (atLastService ?? 0);
    roundsRemaining = ownership.serviceIntervalRounds! - fired;
    basis.push(
      atLastService === undefined
        ? `Counted against the full recorded round count of ${ownership.roundCount}, because no logged service records a round count.`
        : `Counted from ${atLastService} rounds at the last service to ${ownership.roundCount} now.`,
    );
  } else if (hasRounds) {
    basis.push('A round interval is set but no round count is recorded, so it cannot be checked.');
  }

  let daysRemaining: number | null = null;
  let nextDueDate: string | null = null;
  if (hasMonths) {
    nextDueDate = addMonths(since, ownership.serviceIntervalMonths!);
    daysRemaining = nextDueDate === null ? null : daysBetween(today, nextDueDate);
  }

  /*
   * Which deadline to show, when both are set.
   *
   * They are NOT compared to each other — "40 rounds remaining" and "40 days
   * remaining" are different quantities, and a `<=` between them would be
   * arithmetic on unlike units, the exact error `units.ts` exists to prevent.
   * So: whichever has actually expired governs, rounds first because a round
   * interval is the more physical of the two; failing that, whichever the owner
   * has given enough information to evaluate.
   */
  let governedBy: ServiceStatus['governedBy'] = null;
  if (roundsRemaining !== null && roundsRemaining <= 0) governedBy = 'rounds';
  else if (daysRemaining !== null && daysRemaining < 0) governedBy = 'time';
  else if (roundsRemaining !== null) governedBy = 'rounds';
  else if (daysRemaining !== null) governedBy = 'time';

  return {
    since,
    roundsRemaining,
    daysRemaining,
    nextDueDate,
    overdue: (roundsRemaining !== null && roundsRemaining <= 0) || (daysRemaining !== null && daysRemaining < 0),
    governedBy,
    basis,
  };
}

// ---------------------------------------------------------------------------
// Burn rate
// ---------------------------------------------------------------------------

/**
 * Rounds fired per month, over the whole time the owner has had the arm.
 *
 * A long-run average, deliberately: a projection built from the last month
 * would swing wildly for anyone who shoots in seasons, and the figure is being
 * used to answer "roughly when will I hit the next service", not to predict a
 * particular weekend.
 */
export function burnRate(ownership: OwnershipFacts, today: string): Derived {
  const days =
    ownership.acquiredDate === undefined ? null : daysBetween(ownership.acquiredDate, today);
  const months = days === null || days <= 0 ? null : days / DAYS_PER_MONTH;

  return derive({
    formula: 'rounds fired / months owned',
    unit: 'rounds/month',
    inputs: [
      { label: 'rounds fired', of: given(ownership.roundCount ?? null, '', 'your figure') },
      { label: 'months owned', of: given(months, '', 'from the acquisition date you recorded') },
    ],
    assumptions: [
      'An average over the whole period of ownership, not a recent rate. Seasonal shooting will read low in summer and high in winter, or the other way about.',
    ],
    compute: ([rounds, monthsOwned]) => rounds! / monthsOwned!,
  });
}

/**
 * Months until the round-based service interval is reached, at the burn rate.
 *
 * The one genuinely forward-looking figure in the Armory, and the one most
 * likely to be wrong — so it carries the burn rate's own assumption forward
 * rather than presenting itself as a date.
 */
export function monthsToNextService(
  ownership: OwnershipFacts,
  today: string,
): Derived {
  const status = serviceStatus(ownership, today);
  const rate = burnRate(ownership, today);
  const remaining: ValueLike =
    status?.roundsRemaining === undefined || status?.roundsRemaining === null
      ? { value: null, unit: '', status: 'placeholder' }
      : given(Math.max(0, status.roundsRemaining), '', 'from your round interval');

  return derive({
    formula: 'rounds remaining / burn rate',
    unit: 'months',
    inputs: [
      { label: 'rounds remaining', of: remaining },
      { label: 'burn rate', of: { value: rate.value, unit: 'rounds/month', status: rate.status } },
    ],
    assumptions: [
      ...rate.assumptions,
      'A projection from your own past, not a prediction. Shoot more and it arrives sooner.',
    ],
    compute: ([rounds, perMonth]) => (perMonth! <= 0 ? Number.POSITIVE_INFINITY : rounds! / perMonth!),
  });
}

// ---------------------------------------------------------------------------
// Value
// ---------------------------------------------------------------------------

/**
 * A condition-adjusted value, from a base the **owner** supplies.
 *
 * SPEC.md §16 rejects a market-value database outright, so the site supplies
 * the published NRA multiplier and the owner supplies the number it multiplies.
 * The most recent value anchor they recorded is the base; failing that, the
 * price they paid. If they have given neither, there is no estimate — the site
 * does not have one to offer.
 */
export function ownedValue(ownership: OwnershipFacts): Derived | null {
  if (ownership.condition === undefined) return null;

  const anchors = [...ownership.valueAnchors].sort((a, b) => a.date.localeCompare(b.date));
  const latest = anchors[anchors.length - 1];
  const base = latest?.value ?? ownership.acquiredPrice;
  if (base === undefined) return null;

  return conditionAdjustedValue(
    given(
      base,
      '',
      latest
        ? `your own value estimate of ${latest.date}`
        : 'the price you paid, for want of a later figure',
    ),
    ownership.condition,
  );
}

/** Total spent on services, where the owner recorded costs. */
export function serviceSpend(ownership: OwnershipFacts): Derived {
  const costs = ownership.serviceLog.map((event) => event.cost).filter((c): c is number => c !== undefined);
  return derive({
    formula: 'sum of the service costs you logged',
    unit: '',
    inputs: [{ label: 'entries with a cost', of: given(costs.length, '') }],
    assumptions:
      costs.length < ownership.serviceLog.length
        ? [
            `${ownership.serviceLog.length - costs.length} logged service(s) carry no cost, so this is a floor rather than a total.`,
          ]
        : [],
    compute: () => costs.reduce((total, cost) => total + cost, 0),
  });
}
