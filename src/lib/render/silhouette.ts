/**
 * The scale silhouette — SPEC.md §9.6.
 *
 * Up to four firearms overlaid at true scale. Where no photograph-derived
 * outline exists — which today is everywhere — the shape is a **parametric
 * family per firearm type, fitted to that entry's real dimensions**, and it is
 * labelled *"representative outline — the dimensions are sourced, the shape is
 * not"*. Same discipline as Markey's wind-tunnel body: draw the thing, and say
 * exactly which parts of the drawing are claims.
 *
 * ── What is sourced and what is not, precisely ─────────────────────────────
 *  - **Overall length** is sourced, or there is no silhouette. It is the axis
 *    the whole comparison is about, and a guessed length would make the one
 *    thing the reader is measuring the one thing we made up.
 *  - **Height** is sourced when the entry records it. When it does not, the
 *    outline is drawn at a per-type proportion and `heightSourced` is false, so
 *    the caller can say so rather than implying a measurement.
 *  - **Barrel length**, where sourced, positions the muzzle end of the
 *    receiver. It is the one interior feature drawn from data.
 *  - **A magazine** is drawn only for an entry whose recorded feed system has
 *    one. Its size is part of the representative shape; its presence is a fact.
 *  - Everything else — grip rake, comb height, trigger-guard radius — is the
 *    type's generic profile and means nothing about this entry.
 *
 * Pure: numbers in, an SVG path string out. No DOM, no I/O. It lives under
 * `lib/render/` rather than `lib/math/` because a drawing is presentation, and
 * `lib/math` holds only figures a reader is invited to check.
 */
import type { GunData } from '../../schemas/gun.ts';

export interface SilhouetteSubject {
  id: string;
  name: string;
  /** A `type` vocabulary id, or null for a platform entry. */
  type: string | null;
  lengthMm: number | null;
  heightMm: number | null;
  barrelLengthMm: number | null;
  /** True when the recorded feed system is a magazine that hangs below. */
  hasMagazine: boolean;
}

export interface Silhouette {
  id: string;
  name: string;
  /** SVG path, in millimetres, with the origin at the top rear of the arm. */
  path: string;
  lengthMm: number;
  heightMm: number;
  /** False when the height is the type's proportion rather than a measurement. */
  heightSourced: boolean;
  /** False when the barrel position is the type's default rather than sourced. */
  barrelSourced: boolean;
}

/**
 * Height as a fraction of length, used **only** when an entry records no
 * height. These are proportions of a generic drawing, not claims about any
 * arm — which is why nothing downstream may present a figure derived from one.
 */
const HEIGHT_RATIO: Record<string, number> = {
  pistol: 0.74,
  revolver: 0.64,
  rifle: 0.15,
  carbine: 0.17,
  shotgun: 0.13,
  'submachine-gun': 0.26,
  pdw: 0.26,
  'machine-gun': 0.21,
};
const DEFAULT_HEIGHT_RATIO = 0.2;

/** Barrel as a fraction of overall length, when the entry records no barrel. */
const BARREL_RATIO: Record<string, number> = {
  pistol: 0.6,
  revolver: 0.45,
  rifle: 0.6,
  carbine: 0.55,
  shotgun: 0.62,
  'submachine-gun': 0.35,
  pdw: 0.35,
  'machine-gun': 0.55,
};
const DEFAULT_BARREL_RATIO = 0.55;

type Point = readonly [number, number];

/**
 * A right-facing handgun: slide over frame, trigger guard, raked grip.
 * `barrel` is the barrel's share of overall length and sets how far forward the
 * dust cover runs.
 */
function handgunProfile(barrel: number, revolver: boolean): Point[] {
  const dustCover = Math.min(0.92, Math.max(0.45, barrel));
  if (revolver) {
    return [
      [0.0, 0.1],
      [0.34, 0.06],
      [0.42, 0.14],
      [1.0, 0.16],
      [1.0, 0.29],
      [0.6, 0.3],
      [0.56, 0.4],
      [0.38, 0.45],
      [0.32, 0.4],
      [0.28, 0.44],
      [0.26, 0.56],
      [0.14, 0.6],
      [0.12, 0.47],
      [0.24, 1.0],
      [0.02, 1.0],
      [0.0, 0.3],
    ];
  }
  return [
    [0.0, 0.05],
    [1.0, 0.06],
    [1.0, 0.3],
    [dustCover, 0.32],
    [dustCover - 0.06, 0.44],
    [0.46, 0.44],
    [0.44, 0.6],
    [0.3, 0.64],
    [0.26, 0.48],
    [0.3, 1.0],
    [0.04, 1.0],
    [0.0, 0.34],
  ];
}

/**
 * A right-facing shoulder arm: butt, comb, receiver, fore-end, barrel.
 * `barrel` positions the chamber end of the barrel; `magazine` adds the well.
 */
function longArmProfile(barrel: number, magazine: boolean): Point[] {
  // Where the barrel begins, measured from the muzzle back.
  const breech = Math.min(0.85, Math.max(0.25, 1 - barrel));
  const foreEnd = Math.min(breech + (1 - breech) * 0.55, 0.92);

  const points: Point[] = [
    [0.0, 0.12],
    [0.16, 0.06],
    [breech - 0.04, 0.04],
    [breech + 0.02, 0.22],
    [1.0, 0.26],
    [1.0, 0.4],
    [foreEnd, 0.42],
    [foreEnd - 0.04, 0.6],
    [breech - 0.02, 0.62],
  ];

  if (magazine) {
    points.push([breech - 0.06, 0.62], [breech - 0.08, 1.0], [breech - 0.2, 1.0], [breech - 0.22, 0.62]);
  }

  points.push(
    [breech - 0.26, 0.66],
    [breech - 0.3, 0.86],
    [breech - 0.4, 0.88],
    [breech - 0.42, 0.62],
    [0.1, 0.72],
    [0.0, 0.74],
  );

  return points;
}

const HANDGUN_TYPES = new Set(['pistol', 'revolver']);

/** The generic profile for a type, in normalised 0–1 coordinates. */
export function profileFor(type: string | null, barrelFraction: number, magazine: boolean): Point[] {
  if (type === 'revolver') return handgunProfile(barrelFraction, true);
  if (type === 'pistol') return handgunProfile(barrelFraction, false);
  return longArmProfile(barrelFraction, magazine);
}

/**
 * One entry's outline, at true scale in millimetres.
 *
 * Returns `null` when the entry records no overall length: without it there is
 * nothing to draw to scale, and a silhouette that is not to scale is worse than
 * none at all on a page whose whole claim is that its figures are real.
 */
export function silhouetteFor(subject: SilhouetteSubject): Silhouette | null {
  const lengthMm = subject.lengthMm;
  if (lengthMm === null || !Number.isFinite(lengthMm) || lengthMm <= 0) return null;

  const ratio = HEIGHT_RATIO[subject.type ?? ''] ?? DEFAULT_HEIGHT_RATIO;
  const heightSourced = subject.heightMm !== null && subject.heightMm > 0;
  const heightMm = heightSourced ? subject.heightMm! : lengthMm * ratio;

  const barrelSourced = subject.barrelLengthMm !== null && subject.barrelLengthMm > 0;
  const barrelFraction = barrelSourced
    ? Math.min(0.95, subject.barrelLengthMm! / lengthMm)
    : (BARREL_RATIO[subject.type ?? ''] ?? DEFAULT_BARREL_RATIO);

  const profile = profileFor(subject.type, barrelFraction, subject.hasMagazine);
  const path = `${profile
    .map(([x, y], index) => {
      const px = (x * lengthMm).toFixed(1);
      const py = (y * heightMm).toFixed(1);
      return `${index === 0 ? 'M' : 'L'}${px} ${py}`;
    })
    .join(' ')} Z`;

  return {
    id: subject.id,
    name: subject.name,
    path,
    lengthMm,
    heightMm,
    heightSourced,
    barrelSourced,
  };
}

export interface SilhouetteScene {
  silhouettes: Silhouette[];
  /** Viewport in millimetres, wide enough for the longest arm drawn. */
  widthMm: number;
  heightMm: number;
  /** Entries that could not be drawn, and why — never silently dropped. */
  omitted: { id: string; name: string; because: string }[];
}

/** Everything a renderer needs for one overlay, at one shared scale. */
export function buildScene(subjects: readonly SilhouetteSubject[]): SilhouetteScene {
  const silhouettes: Silhouette[] = [];
  const omitted: SilhouetteScene['omitted'] = [];

  for (const subject of subjects) {
    const silhouette = silhouetteFor(subject);
    if (silhouette) silhouettes.push(silhouette);
    else omitted.push({ id: subject.id, name: subject.name, because: 'no sourced overall length' });
  }

  return {
    silhouettes,
    widthMm: Math.max(1, ...silhouettes.map((s) => s.lengthMm)),
    heightMm: Math.max(1, ...silhouettes.map((s) => s.heightMm)),
    omitted,
  };
}

/** True where the type is drawn as a handgun — used only to pick a caption. */
export const isHandgun = (type: string | null): boolean => HANDGUN_TYPES.has(type ?? '');

/**
 * Feed systems that hang a magazine below the receiver.
 *
 * The outline draws one only for an entry whose recorded feed system is in this
 * set, so the presence of a magazine is a fact about the arm even though its
 * shape is not. A belt is deliberately absent: it does not hang as a box, and
 * drawing one would be inventing a silhouette feature.
 */
const HANGING_MAGAZINE = new Set(['detachable-box', 'drum']);

/** The adapter from an entry to a subject. The one place that knows both. */
export function subjectForGun(gun: GunData): SilhouetteSubject {
  const primary = gun.chamberings.find((chambering) => chambering.primary) ?? gun.chamberings[0];
  return {
    id: gun.id,
    name: gun.name,
    type: gun.type ?? null,
    lengthMm: gun.length?.value ?? null,
    heightMm: gun.height?.value ?? null,
    barrelLengthMm: (primary?.barrelLength ?? gun.barrelLength)?.value ?? null,
    hasMagazine: gun.feedSystem.some((feed) => HANGING_MAGAZINE.has(feed)),
  };
}
