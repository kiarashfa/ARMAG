/**
 * Loading and joining content — SPEC.md §5.1.
 *
 * Two files per entry, joined by `id`, **never merged**: the narrative file
 * carries prose and identity, the data file carries the spec. This module is
 * the one place that puts them back together, so a template receives a single
 * object and no page has to know the pairing exists.
 *
 * The join is total rather than partial: an entry whose halves do not both
 * exist is dropped here and reported by `check:content`, so a template never
 * has to defend against half an entry.
 */
import { getCollection, type CollectionEntry } from 'astro:content';

import type { CartridgeData } from '../../schemas/cartridge.ts';
import type { GunData } from '../../schemas/gun.ts';
import type { MakerData } from '../../schemas/maker.ts';

export interface JoinedGun {
  id: string;
  data: GunData;
  narrative: CollectionEntry<'guns'>;
}
export interface JoinedCartridge {
  id: string;
  data: CartridgeData;
  narrative: CollectionEntry<'cartridges'>;
}
export interface JoinedMaker {
  id: string;
  data: MakerData;
  narrative: CollectionEntry<'makers'>;
}

async function join<N extends 'guns' | 'cartridges' | 'makers', D extends 'gunData' | 'cartridgeData' | 'makerData'>(
  narrativeName: N,
  dataName: D,
) {
  const [narratives, datas] = await Promise.all([
    getCollection(narrativeName),
    getCollection(dataName),
  ]);
  const dataById = new Map(datas.map((entry) => [entry.id, entry.data]));

  return narratives
    .filter((entry) => dataById.has(entry.id))
    .map((entry) => ({ id: entry.id, data: dataById.get(entry.id)!, narrative: entry }));
}

export const getGuns = async (): Promise<JoinedGun[]> =>
  (await join('guns', 'gunData')) as unknown as JoinedGun[];

export const getCartridges = async (): Promise<JoinedCartridge[]> =>
  (await join('cartridges', 'cartridgeData')) as unknown as JoinedCartridge[];

export const getMakers = async (): Promise<JoinedMaker[]> =>
  (await join('makers', 'makerData')) as unknown as JoinedMaker[];

// ---------------------------------------------------------------------------
// The computed views — SPEC.md §2 principle 2
// ---------------------------------------------------------------------------

/**
 * The members of a family.
 *
 * Computed from `familyRef`, never hand-maintained, which is what makes
 * re-grouping an entry safe: nothing but the entry itself has to change.
 */
export const membersOfFamily = (guns: JoinedGun[], familyId: string): JoinedGun[] =>
  guns.filter(
    (gun) => gun.data.familyRef === familyId || gun.data.alsoInFamilies.includes(familyId),
  );

/** Everything a maker made. Also computed, for the same reason. */
export const modelsOfMaker = (guns: JoinedGun[], makerId: string): JoinedGun[] =>
  guns.filter((gun) => gun.data.makerRef === makerId);

/** Everything chambered in a cartridge — the other half of the cartridge page. */
export const gunsChamberedIn = (guns: JoinedGun[], cartridgeId: string): JoinedGun[] =>
  guns.filter((gun) =>
    gun.data.chamberings.some((chambering) => chambering.cartridgeRef === cartridgeId),
  );

/** Both directions of the lineage graph, so a page can show what came after it. */
export interface LineageEdges {
  outgoing: { edge: string; target: JoinedGun }[];
  incoming: { edge: string; source: JoinedGun }[];
}

const LINEAGE_EDGES = ['derivedFrom', 'licensedProductionOf', 'cloneOf', 'successorOf'] as const;

export function lineageOf(guns: JoinedGun[], gunId: string): LineageEdges {
  const byId = new Map(guns.map((gun) => [gun.id, gun]));
  const self = byId.get(gunId);

  const outgoing: LineageEdges['outgoing'] = [];
  if (self) {
    for (const edge of LINEAGE_EDGES) {
      const targetId = self.data.lineage[edge];
      const target = targetId ? byId.get(targetId) : undefined;
      if (target) outgoing.push({ edge, target });
    }
  }

  const incoming: LineageEdges['incoming'] = [];
  for (const gun of guns) {
    if (gun.id === gunId) continue;
    for (const edge of LINEAGE_EDGES) {
      if (gun.data.lineage[edge] === gunId) incoming.push({ edge, source: gun });
    }
  }

  return { outgoing, incoming };
}

/** How each lineage edge reads in a sentence, in both directions. */
export const LINEAGE_LABEL: Record<string, { outgoing: string; incoming: string }> = {
  derivedFrom: { outgoing: 'Derived from', incoming: 'Derivatives' },
  licensedProductionOf: { outgoing: 'Licensed production of', incoming: 'Licensed as' },
  cloneOf: { outgoing: 'Clone of', incoming: 'Cloned as' },
  successorOf: { outgoing: 'Successor to', incoming: 'Succeeded by' },
};
