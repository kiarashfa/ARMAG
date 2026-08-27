/**
 * My Armory's state, its store, and the two ways it leaves the browser —
 * SPEC.md §9.4.
 *
 * Everything in this file is pure except the store itself, which goes through
 * `defineStore` in `index.ts` and inherits its whole contract: namespaced key,
 * versioned envelope, schema-checked on read, unrecognised version discarded
 * **whole** with a visible notice (SPEC.md §9.9).
 *
 * ── The two exports, and why they are not the same function ────────────────
 * A **share link** carries slots and slugs. A **backup file** carries
 * everything, ownership included. That distinction is the point, so it is made
 * structurally rather than by remembering to strip fields: `armoryShareSchema`
 * declares its entries `.strict()` with exactly three keys, so a share payload
 * carrying an `ownership` object fails to parse rather than travelling.
 * `toShare()` builds from those three fields by name; there is no spread, and
 * no way for a field added to `ArmoryEntry` later to leak into a URL by
 * default. A test asserts a fully-populated armory produces a share link
 * containing none of its ownership data.
 *
 * ── There is no serial number, here or anywhere ────────────────────────────
 * SPEC.md §9.4. A leaked save must never be a theft shopping list. The schema
 * has no such field and `armory.test.ts` asserts the identifier appears nowhere
 * in `src/`.
 */
import {
  ARMORY_CAPACITIES,
  ARMORY_SCHEMA_VERSION,
  armoryShareSchema,
  armoryStateSchema,
  type ArmoryEntry,
  type ArmoryShare,
  type ArmoryState,
} from '../../schemas/armory.ts';
import { defineStore, type Store } from './index.ts';

export type ArmoryCapacity = (typeof ARMORY_CAPACITIES)[number];

export const EMPTY_ARMORY: ArmoryState = {
  version: ARMORY_SCHEMA_VERSION,
  capacity: 10,
  entries: [],
  units: 'metric',
};

/**
 * The schema gate the store runs on every read.
 *
 * Returns `null` for anything it does not fully recognise. It never repairs:
 * a half-understood blob put back into the grid is a bay the visitor never
 * filled, and they would have no way to know which one.
 */
export const parseArmory = (raw: unknown): ArmoryState | null => {
  const result = armoryStateSchema.safeParse(raw);
  return result.success ? result.data : null;
};

/**
 * The store. Its name is `armory`; `defineStore` namespaces it to
 * `armag:armory` and wraps the payload in its own `{ v, data }` envelope.
 *
 * The state ALSO carries a `version` field of its own, and that is not
 * redundant: the envelope exists only inside `localStorage`, while a backup
 * file is a bare document that has to say what it is when it is imported on
 * another machine a year later.
 */
export const armoryStore: Store<ArmoryState> = defineStore<ArmoryState>(
  'armory',
  ARMORY_SCHEMA_VERSION,
  parseArmory,
);

// ---------------------------------------------------------------------------
// Pure state operations
// ---------------------------------------------------------------------------

/** Bay numbers with nothing in them, in order. */
export function freeSlots(state: ArmoryState): number[] {
  const taken = new Set(state.entries.map((entry) => entry.slot));
  const free: number[] = [];
  for (let slot = 0; slot < state.capacity; slot += 1) if (!taken.has(slot)) free.push(slot);
  return free;
}

export const isFull = (state: ArmoryState): boolean => freeSlots(state).length === 0;

/**
 * Adds an entry to the first free bay, or to `slot` when one is asked for.
 *
 * Returns the state unchanged when there is no room — the caller reports it.
 * Silently dropping would be the same thing without the sentence.
 */
export function addEntry(
  state: ArmoryState,
  entry: Omit<ArmoryEntry, 'slot'> & { slot?: number },
): ArmoryState {
  const free = freeSlots(state);
  const slot = entry.slot ?? free[0];
  if (slot === undefined || slot >= state.capacity) return state;
  if (state.entries.some((existing) => existing.slot === slot)) return state;

  return {
    ...state,
    entries: [...state.entries, { ...entry, slot }].sort((a, b) => a.slot - b.slot),
  };
}

export function removeEntry(state: ArmoryState, uid: string): ArmoryState {
  return { ...state, entries: state.entries.filter((entry) => entry.uid !== uid) };
}

export function updateEntry(
  state: ArmoryState,
  uid: string,
  change: (entry: ArmoryEntry) => ArmoryEntry,
): ArmoryState {
  return {
    ...state,
    entries: state.entries.map((entry) => (entry.uid === uid ? change(entry) : entry)),
  };
}

/** Moves an entry to another bay, swapping with whatever is already there. */
export function moveEntry(state: ArmoryState, uid: string, toSlot: number): ArmoryState {
  if (toSlot < 0 || toSlot >= state.capacity) return state;
  const moving = state.entries.find((entry) => entry.uid === uid);
  if (!moving) return state;
  const occupant = state.entries.find((entry) => entry.slot === toSlot);

  return {
    ...state,
    entries: state.entries
      .map((entry) => {
        if (entry.uid === uid) return { ...entry, slot: toSlot };
        if (occupant && entry.uid === occupant.uid) return { ...entry, slot: moving.slot };
        return entry;
      })
      .sort((a, b) => a.slot - b.slot),
  };
}

/**
 * Which entries a downsize would actually lose — SPEC.md §9.4: *"downsizing
 * warns before eviction."*
 *
 * Separated from `setCapacity` on purpose. The UI has to be able to ask the
 * question before doing the thing, and a function that both computes the
 * casualties and inflicts them cannot be used to write the warning.
 *
 * "Beyond the new capacity by bay number" is NOT the answer: someone dropping
 * from 50 to 10 with eight arms in scattered bays means to keep their eight
 * arms, not to lose the six that happen to sit above bay 10. So the real answer
 * is what is left over after the displaced entries have been rehomed into the
 * bays that remain free.
 */
export function evictedBy(state: ArmoryState, capacity: ArmoryCapacity): ArmoryEntry[] {
  const staying = state.entries.filter((entry) => entry.slot < capacity);
  const displaced = state.entries
    .filter((entry) => entry.slot >= capacity)
    .sort((a, b) => a.slot - b.slot);
  return displaced.slice(Math.max(0, capacity - staying.length));
}

/**
 * Changes the capacity, rehoming anything that no longer fits.
 *
 * An entry whose bay still exists **does not move**. Renumbering everyone on
 * every capacity change would shuffle a visitor's grid for no reason they asked
 * for, including when they re-pick the size they already had. Only entries
 * whose bay has gone are moved, into the lowest free bays, in their old order.
 * Whatever is still left over is dropped — and `evictedBy` has already named it.
 */
export function setCapacity(state: ArmoryState, capacity: ArmoryCapacity): ArmoryState {
  const staying = state.entries.filter((entry) => entry.slot < capacity);
  const displaced = state.entries
    .filter((entry) => entry.slot >= capacity)
    .sort((a, b) => a.slot - b.slot);

  const taken = new Set(staying.map((entry) => entry.slot));
  const free: number[] = [];
  for (let slot = 0; slot < capacity; slot += 1) if (!taken.has(slot)) free.push(slot);

  const rehomed = displaced
    .slice(0, free.length)
    .map((entry, index) => ({ ...entry, slot: free[index]! }));

  return {
    ...state,
    capacity,
    entries: [...staying, ...rehomed].sort((a, b) => a.slot - b.slot),
  };
}

// ---------------------------------------------------------------------------
// Share link — slots and slugs only
// ---------------------------------------------------------------------------

/**
 * The share payload.
 *
 * Built field by field. There is deliberately no `...entry` here: a spread
 * would mean that any field added to `ArmoryEntry` in future travels in every
 * share link ever made afterwards, and nobody would notice until it did.
 */
export function toShare(state: ArmoryState): ArmoryShare {
  return {
    version: ARMORY_SCHEMA_VERSION,
    capacity: state.capacity,
    entries: state.entries.map((entry) => ({
      gunRef: entry.gunRef,
      ...(entry.variantRef ? { variantRef: entry.variantRef } : {}),
      slot: entry.slot,
    })),
  };
}

/**
 * URL-safe base64 of the share payload.
 *
 * Not encryption and not obfuscation — anyone can decode it, which is the
 * point of a share link. It is base64 rather than readable JSON only so the URL
 * survives being pasted into software that mangles braces and quotes.
 */
export function encodeShare(state: ArmoryState): string {
  return base64UrlEncode(JSON.stringify(toShare(state)));
}

/** Returns `null` for anything that is not a share payload we recognise. */
export function decodeShare(token: string): ArmoryShare | null {
  const json = base64UrlDecode(token);
  if (json === null) return null;
  try {
    const result = armoryShareSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * A shared layout, turned into state this browser can hold.
 *
 * Every entry arrives with **no ownership**, because none travelled. `addedAt`
 * is the day the link was opened, which is the only honest answer: we do not
 * know when the person who made the link acquired anything, and we are not
 * going to pretend the share carried a date it did not.
 */
export function fromShare(share: ArmoryShare, today: string, uid: () => string): ArmoryState {
  return {
    version: ARMORY_SCHEMA_VERSION,
    capacity: share.capacity,
    entries: share.entries.map((entry) => ({
      uid: uid(),
      gunRef: entry.gunRef,
      ...(entry.variantRef ? { variantRef: entry.variantRef } : {}),
      slot: entry.slot,
      addedAt: today,
    })),
    units: 'metric',
  };
}

// ---------------------------------------------------------------------------
// Backup file — everything, and labelled as such
// ---------------------------------------------------------------------------

/**
 * The full backup, ownership included.
 *
 * A bare `ArmoryState` document rather than the storage envelope: it has to be
 * readable a year later by a build that has changed, and the `version` field
 * inside the state is what tells it whether it can be.
 */
export const toBackup = (state: ArmoryState): string => JSON.stringify(state, null, 2);

/** Returns `null` rather than a partial armory for anything unrecognised. */
export function fromBackup(json: string): ArmoryState | null {
  try {
    return parseArmory(JSON.parse(json));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// base64url, without a dependency
// ---------------------------------------------------------------------------

/**
 * `btoa` handles bytes, not characters, so a nickname containing anything above
 * U+00FF throws. Encoding to UTF-8 first is what lets someone call a bay
 * `Автомат` and still have a working share link.
 */
export function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(token: string): string | null {
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}
