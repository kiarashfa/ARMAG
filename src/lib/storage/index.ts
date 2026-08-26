/**
 * The one client-storage wrapper — SPEC.md §9.9.
 *
 * *"Namespaced and versioned keys, every blob schema-checked on read, an
 * unrecognised version discarded whole rather than partially parsed, every
 * read/write wrapped for environments where storage is not available. An honest
 * one-line notice when something could not be remembered — never a silent
 * failure."*
 *
 * Written in Phase 6 rather than Phase 7 because the compare tray is client
 * storage and SPEC.md §9.9 admits no exceptions: a tray that wrote a bare
 * `localStorage.setItem` would be the second storage mechanism on the site
 * before the first one existed. My Armory extends this in Phase 7; it does not
 * replace it.
 *
 * ── Why an unrecognised version is discarded whole ────────────────────────
 * Partial migration is where saved state goes wrong quietly. A blob half-read
 * by a newer schema produces an entry that looks present and behaves oddly,
 * which is far worse for a reader than being told their tray was cleared. So a
 * version mismatch, a parse failure and a failed check all take the same path:
 * discard, report, carry on.
 */

/** Every key this site writes is prefixed. Nothing else may write here. */
const NAMESPACE = 'armag';

export type StorageOutcome = 'ok' | 'unavailable' | 'discarded-version' | 'discarded-invalid';

export interface ReadResult<T> {
  value: T | null;
  outcome: StorageOutcome;
  /** One line, for the reader. Empty when nothing went wrong. */
  notice: string;
}

interface Envelope {
  v: number;
  data: unknown;
}

export interface Store<T> {
  /** `<namespace>:<name>` — what actually appears in the storage inspector. */
  readonly key: string;
  read(): ReadResult<T>;
  write(value: T): StorageOutcome;
  clear(): void;
}

/**
 * `localStorage` throws rather than returning null in a private window on some
 * browsers, and is absent entirely during server rendering, so every access
 * goes through here.
 */
function backing(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    // Touching a key is the only reliable probe: the object can exist and still
    // throw on use when site data is blocked.
    const probe = `${NAMESPACE}:__probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

const NOTICE = {
  unavailable:
    'This browser will not let the site store anything, so nothing here will be remembered after you leave.',
  version:
    'A saved item was written by an older version of this site and could not be read, so it was cleared.',
  invalid: 'A saved item was damaged and could not be read, so it was cleared.',
} as const;

/**
 * Defines a versioned store.
 *
 * `check` is the schema gate. It runs on every read and must return `null` for
 * anything it does not fully recognise — returning a repaired object would
 * reintroduce exactly the partial-parse failure this module exists to prevent.
 */
export function defineStore<T>(name: string, version: number, check: (raw: unknown) => T | null): Store<T> {
  const key = `${NAMESPACE}:${name}`;

  const clear = (): void => {
    try {
      backing()?.removeItem(key);
    } catch {
      /* Nothing to do: it was already unreachable. */
    }
  };

  return {
    key,

    read(): ReadResult<T> {
      const storage = backing();
      if (!storage) return { value: null, outcome: 'unavailable', notice: NOTICE.unavailable };

      let raw: string | null = null;
      try {
        raw = storage.getItem(key);
      } catch {
        return { value: null, outcome: 'unavailable', notice: NOTICE.unavailable };
      }
      if (raw === null) return { value: null, outcome: 'ok', notice: '' };

      let envelope: Envelope;
      try {
        envelope = JSON.parse(raw) as Envelope;
      } catch {
        clear();
        return { value: null, outcome: 'discarded-invalid', notice: NOTICE.invalid };
      }

      if (typeof envelope !== 'object' || envelope === null || envelope.v !== version) {
        clear();
        return { value: null, outcome: 'discarded-version', notice: NOTICE.version };
      }

      const checked = check(envelope.data);
      if (checked === null) {
        clear();
        return { value: null, outcome: 'discarded-invalid', notice: NOTICE.invalid };
      }

      return { value: checked, outcome: 'ok', notice: '' };
    },

    write(value: T): StorageOutcome {
      const storage = backing();
      if (!storage) return 'unavailable';
      try {
        storage.setItem(key, JSON.stringify({ v: version, data: value } satisfies Envelope));
        return 'ok';
      } catch {
        // A quota failure is indistinguishable from a blocked write here, and
        // both mean the same thing to the reader: it was not remembered.
        return 'unavailable';
      }
    },

    clear,
  };
}

// ---------------------------------------------------------------------------
// The compare tray — SPEC.md §9.2
// ---------------------------------------------------------------------------

/** Up to four, per SPEC.md §9.2. Stored as slugs and display names, nothing else. */
export interface TrayItem {
  id: string;
  name: string;
}

export const COMPARE_LIMIT = 4;

const isTray = (raw: unknown): TrayItem[] | null => {
  if (!Array.isArray(raw)) return null;
  const items: TrayItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { id, name } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string') return null;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return null;
    items.push({ id, name });
  }
  return items.slice(0, COMPARE_LIMIT);
};

export const compareTrayStore = defineStore<TrayItem[]>('compare-tray', 1, isTray);
