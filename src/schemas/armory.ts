/**
 * My Armory — SPEC.md §9.4.
 *
 * This is the only schema on the site that never validates a file in the repo.
 * It validates a blob read back out of the visitor's own `localStorage`, which
 * is a hostile input: it may have been written by an older version of the site,
 * hand-edited, truncated by a full disk, or restored from someone else's
 * backup. SPEC.md §2 principle 7 is that an unrecognised version is discarded
 * **whole** rather than partially parsed, and this schema is what "recognised"
 * means.
 *
 * ── There is no serial number field, and there never will be ───────────────
 * Not here, not in the backup file, not in the share link — SPEC.md §9.4 and
 * §16. A leaked save must never be a theft shopping list, and a nickname does
 * the same job for the person using it. This is a permanent exclusion; an
 * integrity test asserts the field name appears nowhere in the codebase.
 */
import { z } from 'zod';

import { isoDate, slug } from './primitives.ts';

/**
 * Bumped whenever a change would make an older blob misread rather than merely
 * incomplete. On mismatch the whole blob is discarded with a visible notice —
 * never silently, because the visitor's own data disappearing without a word is
 * the worst failure this feature has available.
 */
export const ARMORY_SCHEMA_VERSION = 1;

/*
 * There is deliberately no storage-key constant here. `lib/storage` owns key
 * construction — it namespaces this store to `armag:armory` and carries the
 * version in its own `{ v, data }` envelope — and a key written out a second
 * time in this file was already disagreeing with the real one.
 */

/**
 * The NRA condition scale, as published. Used with a base value the **user**
 * supplies: SPEC.md §16 rejects a market-value database outright, so the site
 * supplies the multiplier and the reader supplies the number it multiplies.
 */
export const nraConditionGrade = z.enum([
  'new-100',
  'excellent-95',
  'fine-80',
  'very-good-70',
  'good-60',
  'fair-40',
  'poor-30',
]);
export type NraConditionGrade = z.infer<typeof nraConditionGrade>;

export const serviceEvent = z.object({
  date: isoDate,
  /** Round count at the time of service, where the owner tracked it. */
  rounds: z.number().int().nonnegative().optional(),
  type: z.enum(['cleaning', 'parts-replacement', 'gunsmith', 'inspection', 'other']),
  cost: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});
export type ServiceEvent = z.infer<typeof serviceEvent>;

/**
 * Present only when the visitor ticks "I own this".
 *
 * `serviceInterval*` are USER-SET. The site never invents a maintenance
 * interval: a wrong one is either a false alarm or a false all-clear, and
 * neither is ours to issue.
 */
export const ownership = z.object({
  acquiredDate: isoDate.optional(),
  acquiredPrice: z.number().nonnegative().optional(),
  condition: nraConditionGrade.optional(),
  roundCount: z.number().int().nonnegative().optional(),
  serviceIntervalRounds: z.number().int().positive().optional(),
  serviceIntervalMonths: z.number().int().positive().optional(),
  serviceLog: z.array(serviceEvent).default([]),
  /** The owner's own value estimates over time, for the burn-rate chart. */
  valueAnchors: z
    .array(z.object({ date: isoDate, value: z.number().nonnegative() }))
    .default([]),
});
export type Ownership = z.infer<typeof ownership>;

export const armoryEntry = z.object({
  /** Random. The same gun may be parked in two bays — a pair, a before/after. */
  uid: z.string().min(1),
  gunRef: slug,
  variantRef: slug.optional(),
  slot: z.number().int().nonnegative(),
  nickname: z.string().max(60).optional(),
  addedAt: isoDate,
  ownership: ownership.optional(),
});
export type ArmoryEntry = z.infer<typeof armoryEntry>;

/** Capacity tiers the visitor chooses between; downsizing warns before eviction. */
export const ARMORY_CAPACITIES = [10, 20, 50] as const;

export const armoryStateSchema = z
  .object({
    version: z.literal(ARMORY_SCHEMA_VERSION),
    capacity: z.union([z.literal(10), z.literal(20), z.literal(50)]),
    entries: z.array(armoryEntry).default([]),
    /** The visitor's unit preference, kept with their other state. */
    units: z.enum(['metric', 'imperial']).default('metric'),
    updatedAt: isoDate.optional(),
  })
  .superRefine((state, ctx) => {
    const slots = state.entries.map((e) => e.slot);
    const dupes = [...new Set(slots.filter((s, i) => slots.indexOf(s) !== i))];
    if (dupes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['entries'],
        message: `two entries occupy bay ${dupes[0]}`,
      });
    }
    for (const entry of state.entries) {
      if (entry.slot >= state.capacity) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries'],
          message: `bay ${entry.slot} is beyond the chosen capacity of ${state.capacity}`,
        });
      }
    }
    const uids = state.entries.map((e) => e.uid);
    if (new Set(uids).size !== uids.length) {
      ctx.addIssue({ code: 'custom', path: ['entries'], message: 'duplicate entry uid' });
    }
  });
export type ArmoryState = z.infer<typeof armoryStateSchema>;

/**
 * The share link's payload — SPEC.md §9.4.
 *
 * Slots and slugs only. No ownership data, no dates, no prices. The **full
 * backup** is a separate, explicitly labelled action that does include
 * ownership, and the UI states the difference at the moment of sharing rather
 * than burying it in an about page.
 */
export const armoryShareSchema = z.object({
  version: z.literal(ARMORY_SCHEMA_VERSION),
  capacity: z.union([z.literal(10), z.literal(20), z.literal(50)]),
  entries: z.array(
    z
      .object({
        gunRef: slug,
        variantRef: slug.optional(),
        slot: z.number().int().nonnegative(),
      })
      .strict(),
  ),
});
export type ArmoryShare = z.infer<typeof armoryShareSchema>;
