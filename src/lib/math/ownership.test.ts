/**
 * Ownership arithmetic — SPEC.md §9.4.
 *
 * The rule under test throughout is that the site computes from the owner's own
 * figures and refuses to compute without them. A service interval nobody set is
 * not a service interval of zero, and a value estimate with no base is not a
 * value estimate of the launch price.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  addMonths,
  burnRate,
  daysBetween,
  monthsToNextService,
  ownedValue,
  serviceSpend,
  serviceStatus,
  type OwnershipFacts,
} from './ownership.ts';

const TODAY = '2026-08-27';

const facts = (over: Partial<OwnershipFacts> = {}): OwnershipFacts => ({
  serviceLog: [],
  valueAnchors: [],
  ...over,
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test('day arithmetic is exact and signed', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-31'), 30);
  assert.equal(daysBetween('2026-01-31', '2026-01-01'), -30);
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2, 'a leap year has a 29th');
  assert.equal(daysBetween('not-a-date', '2026-01-01'), null);
});

test('adding months uses a stated average rather than guessing at month ends', () => {
  // "Six months from the 31st" has no single correct answer; the average month
  // keeps it reversible and the error under two days across a year.
  assert.equal(addMonths('2026-01-01', 12), '2027-01-01');
  // Six average months from 1 January lands a day past 1 July, and saying so is
  // more honest than pretending the calendar divides evenly.
  assert.equal(addMonths('2026-01-01', 6), '2026-07-02');
  assert.equal(addMonths('2026-01-01', 0), '2026-01-01');
  assert.equal(addMonths('nope', 6), null);
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

test('no interval set means no service status — none is invented', () => {
  assert.equal(serviceStatus(facts({ roundCount: 9000 }), TODAY), null);
});

test('an interval with no date to measure from cannot be evaluated', () => {
  assert.equal(serviceStatus(facts({ serviceIntervalMonths: 6 }), TODAY), null);
});

test('rounds remaining are counted from the last service that logged a count', () => {
  const status = serviceStatus(
    facts({
      acquiredDate: '2024-01-01',
      roundCount: 4200,
      serviceIntervalRounds: 5000,
      serviceLog: [{ date: '2025-01-11', rounds: 2000, type: 'cleaning' }],
    }),
    TODAY,
  )!;
  assert.equal(status.since, '2025-01-11');
  assert.equal(status.roundsRemaining, 5000 - (4200 - 2000));
  assert.equal(status.overdue, false);
  assert.ok(status.basis.some((line) => line.includes('2000 rounds at the last service')));
});

test('with no logged round count the whole count is used, and the basis says so', () => {
  const status = serviceStatus(
    facts({ acquiredDate: '2024-01-01', roundCount: 6000, serviceIntervalRounds: 5000 }),
    TODAY,
  )!;
  assert.equal(status.roundsRemaining, -1000);
  assert.equal(status.overdue, true);
  assert.equal(status.governedBy, 'rounds');
  assert.ok(status.basis.some((line) => line.includes('full recorded round count')));
});

test('a round interval with no round count is reported, not silently ignored', () => {
  const status = serviceStatus(
    facts({ acquiredDate: '2026-01-01', serviceIntervalRounds: 5000 }),
    TODAY,
  )!;
  assert.equal(status.roundsRemaining, null);
  assert.equal(status.governedBy, null);
  assert.ok(status.basis.some((line) => line.includes('cannot be checked')));
});

test('a months interval produces a due date and a signed countdown', () => {
  const due = serviceStatus(
    facts({ acquiredDate: '2026-06-01', serviceIntervalMonths: 6 }),
    TODAY,
  )!;
  assert.equal(due.nextDueDate, addMonths('2026-06-01', 6));
  assert.ok(due.daysRemaining! > 0);
  assert.equal(due.overdue, false);
  assert.equal(due.governedBy, 'time');

  const late = serviceStatus(
    facts({ acquiredDate: '2024-01-01', serviceIntervalMonths: 6 }),
    TODAY,
  )!;
  assert.ok(late.daysRemaining! < 0);
  assert.equal(late.overdue, true);
});

test('an expired interval governs the message, whichever one it is', () => {
  const roundsGone = serviceStatus(
    facts({
      acquiredDate: '2026-08-01',
      roundCount: 9000,
      serviceIntervalRounds: 5000,
      serviceIntervalMonths: 12,
    }),
    TODAY,
  )!;
  assert.equal(roundsGone.governedBy, 'rounds');

  const timeGone = serviceStatus(
    facts({
      acquiredDate: '2020-01-01',
      roundCount: 10,
      serviceIntervalRounds: 5000,
      serviceIntervalMonths: 12,
    }),
    TODAY,
  )!;
  assert.equal(timeGone.governedBy, 'time');
  assert.equal(timeGone.overdue, true);
});

test('the last service is found regardless of the order it was logged in', () => {
  const status = serviceStatus(
    facts({
      acquiredDate: '2020-01-01',
      serviceIntervalMonths: 6,
      serviceLog: [
        { date: '2026-07-01', type: 'cleaning' },
        { date: '2021-02-02', type: 'gunsmith' },
      ],
    }),
    TODAY,
  )!;
  assert.equal(status.since, '2026-07-01');
});

// ---------------------------------------------------------------------------
// Burn rate
// ---------------------------------------------------------------------------

test('burn rate is rounds over months owned, and blocks without either', () => {
  const rate = burnRate(facts({ acquiredDate: '2025-08-27', roundCount: 1200 }), TODAY);
  assert.ok(rate.value !== null);
  assert.ok(Math.abs(rate.value! - 100) < 1, `expected about 100 rounds a month, got ${rate.value}`);
  assert.ok(rate.assumptions.some((line) => line.includes('average')));

  assert.equal(burnRate(facts({ roundCount: 1200 }), TODAY).value, null);
  assert.equal(burnRate(facts({ acquiredDate: '2025-08-27' }), TODAY).value, null);
});

test('an arm acquired today has no burn rate rather than an infinite one', () => {
  const rate = burnRate(facts({ acquiredDate: TODAY, roundCount: 50 }), TODAY);
  assert.equal(rate.value, null);
  assert.equal(rate.blockedBy, 'months owned');
});

test('the projection to the next service names what blocked it', () => {
  const projected = monthsToNextService(
    facts({
      acquiredDate: '2025-08-27',
      roundCount: 1200,
      serviceIntervalRounds: 2000,
    }),
    TODAY,
  );
  assert.ok(projected.value !== null);
  assert.ok(Math.abs(projected.value! - 8) < 0.5, `expected about 8 months, got ${projected.value}`);
  assert.ok(projected.assumptions.some((line) => line.includes('not a prediction')));

  // No interval at all: nothing to project towards.
  const blocked = monthsToNextService(
    facts({ acquiredDate: '2025-08-27', roundCount: 1200 }),
    TODAY,
  );
  assert.equal(blocked.value, null);
  assert.equal(blocked.blockedBy, 'rounds remaining');
});

// ---------------------------------------------------------------------------
// Value
// ---------------------------------------------------------------------------

test('a value estimate needs a condition and a base the owner supplied', () => {
  assert.equal(ownedValue(facts({ acquiredPrice: 600 })), null, 'no condition, no estimate');
  assert.equal(ownedValue(facts({ condition: 'fine-80' })), null, 'no base, no estimate');
});

test('the most recent anchor is the base, falling back to the price paid', () => {
  const anchored = ownedValue(
    facts({
      condition: 'excellent-95',
      acquiredPrice: 600,
      valueAnchors: [
        { date: '2025-01-01', value: 650 },
        { date: '2026-01-01', value: 700 },
      ],
    }),
  )!;
  assert.equal(anchored.value, 700 * 0.95);
  assert.ok(anchored.inputs[0]!.sourceNote?.includes('2026-01-01'));

  const paid = ownedValue(facts({ condition: 'fine-80', acquiredPrice: 600 }))!;
  assert.equal(paid.value, 600 * 0.8);
  assert.ok(paid.inputs[0]!.sourceNote?.includes('price you paid'));
});

test('the value estimate says the base is the owner̕s, not ours', () => {
  const estimate = ownedValue(facts({ condition: 'good-60', acquiredPrice: 500 }))!;
  assert.ok(
    estimate.assumptions.some((line) => line.includes('yours, not ours')),
    'SPEC.md §16: the site holds no market-value data and must say so here',
  );
});

// ---------------------------------------------------------------------------
// Spend
// ---------------------------------------------------------------------------

test('service spend is a floor when some entries carry no cost', () => {
  const total = serviceSpend(
    facts({
      serviceLog: [
        { date: '2025-01-01', type: 'cleaning', cost: 40 },
        { date: '2025-06-01', type: 'gunsmith', cost: 120 },
        { date: '2026-01-01', type: 'inspection' },
      ],
    }),
  );
  assert.equal(total.value, 160);
  assert.ok(total.assumptions[0]?.includes('floor'));

  const complete = serviceSpend(
    facts({ serviceLog: [{ date: '2025-01-01', type: 'cleaning', cost: 40 }] }),
  );
  assert.equal(complete.value, 40);
  assert.deepEqual(complete.assumptions, []);
});
