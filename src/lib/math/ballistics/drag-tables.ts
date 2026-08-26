/**
 * The G1 and G7 standard drag functions - SPEC.md SS8.1 and Appendix A.
 *
 * -- Provenance, because this is the physics core -------------------------
 * These tables are the US Army Ballistic Research Laboratory standard drag
 * functions and are **public domain**. They were not written from memory and
 * they were not derived: they were transcribed from
 * <https://jbmballistics.com/downloads/mcg1.txt> and `mcg7.txt`, then checked
 * row for row against a second, independent implementation
 * (py-ballisticcalc 2.2.0, `py_ballisticcalc/drag_tables.py`). All 79 G1 rows
 * and all 84 G7 rows agree exactly. Retrieved 2026-08-26.
 *
 * That cross-check is not ceremony. Every ballistic figure on the site is
 * computed from these numbers, so one mistyped digit here would be a
 * fabrication propagated to three thousand pages, wearing a formula panel
 * that says the figure was derived.
 *
 * -- Which model to use ---------------------------------------------------
 * G1 is a flat-base bullet with a short ogive, the shape most sporting
 * ammunition is still advertised against. G7 is a boat-tail spitzer and is
 * the honest model for a modern long-range match bullet. A BC quoted for one
 * cannot be used with the other: the two functions differ by more than a
 * factor of two at Mach 3, so swapping them produces a confident wrong answer
 * rather than an obviously broken one.
 */

/** `[mach, dragCoefficient]`, ascending by Mach. */
export type DragTable = readonly (readonly [number, number])[];

export type DragModel = 'G1' | 'G7';

/** Flat-base, 2-caliber ogive - the classic sporting-ammunition standard. */
export const G1: DragTable = [
  [0.00, 0.2629],
  [0.05, 0.2558],
  [0.10, 0.2487],
  [0.15, 0.2413],
  [0.20, 0.2344],
  [0.25, 0.2278],
  [0.30, 0.2214],
  [0.35, 0.2155],
  [0.40, 0.2104],
  [0.45, 0.2061],
  [0.50, 0.2032],
  [0.55, 0.2020],
  [0.60, 0.2034],
  [0.70, 0.2165],
  [0.72, 0.2230],
  [0.75, 0.2313],
  [0.78, 0.2417],
  [0.80, 0.2546],
  [0.82, 0.2706],
  [0.85, 0.2901],
  [0.88, 0.3136],
  [0.90, 0.3415],
  [0.93, 0.3734],
  [0.95, 0.4084],
  [0.97, 0.4448],
  [1.00, 0.4805],
  [1.02, 0.5136],
  [1.05, 0.5427],
  [1.07, 0.5677],
  [1.10, 0.5883],
  [1.12, 0.6053],
  [1.15, 0.6191],
  [1.20, 0.6393],
  [1.25, 0.6518],
  [1.30, 0.6589],
  [1.35, 0.6621],
  [1.40, 0.6625],
  [1.45, 0.6607],
  [1.50, 0.6573],
  [1.55, 0.6528],
  [1.60, 0.6474],
  [1.65, 0.6413],
  [1.70, 0.6347],
  [1.75, 0.6280],
  [1.80, 0.6210],
  [1.85, 0.6141],
  [1.90, 0.6072],
  [1.95, 0.6003],
  [2.00, 0.5934],
  [2.05, 0.5867],
  [2.10, 0.5804],
  [2.15, 0.5743],
  [2.20, 0.5685],
  [2.25, 0.5630],
  [2.30, 0.5577],
  [2.35, 0.5527],
  [2.40, 0.5481],
  [2.45, 0.5438],
  [2.50, 0.5397],
  [2.60, 0.5325],
  [2.70, 0.5264],
  [2.80, 0.5211],
  [2.90, 0.5168],
  [3.00, 0.5133],
  [3.10, 0.5105],
  [3.20, 0.5084],
  [3.30, 0.5067],
  [3.40, 0.5054],
  [3.50, 0.5040],
  [3.60, 0.5030],
  [3.70, 0.5022],
  [3.80, 0.5016],
  [3.90, 0.5010],
  [4.00, 0.5006],
  [4.20, 0.4998],
  [4.40, 0.4995],
  [4.60, 0.4992],
  [4.80, 0.4990],
  [5.00, 0.4988],
];

/** Boat-tail, 10-caliber secant ogive - the long-range match standard. */
export const G7: DragTable = [
  [0.00, 0.1198],
  [0.05, 0.1197],
  [0.10, 0.1196],
  [0.15, 0.1194],
  [0.20, 0.1193],
  [0.25, 0.1194],
  [0.30, 0.1194],
  [0.35, 0.1194],
  [0.40, 0.1193],
  [0.45, 0.1193],
  [0.50, 0.1194],
  [0.55, 0.1193],
  [0.60, 0.1194],
  [0.65, 0.1197],
  [0.70, 0.1202],
  [0.72, 0.1207],
  [0.75, 0.1215],
  [0.78, 0.1226],
  [0.80, 0.1242],
  [0.82, 0.1266],
  [0.85, 0.1306],
  [0.88, 0.1368],
  [0.90, 0.1464],
  [0.93, 0.1660],
  [0.95, 0.2054],
  [0.97, 0.2993],
  [1.00, 0.3803],
  [1.02, 0.4015],
  [1.05, 0.4043],
  [1.07, 0.4034],
  [1.10, 0.4014],
  [1.12, 0.3987],
  [1.15, 0.3955],
  [1.20, 0.3884],
  [1.25, 0.3810],
  [1.30, 0.3732],
  [1.35, 0.3657],
  [1.40, 0.3580],
  [1.50, 0.3440],
  [1.55, 0.3376],
  [1.60, 0.3315],
  [1.65, 0.3260],
  [1.70, 0.3209],
  [1.75, 0.3160],
  [1.80, 0.3117],
  [1.85, 0.3078],
  [1.90, 0.3042],
  [1.95, 0.3010],
  [2.00, 0.2980],
  [2.05, 0.2951],
  [2.10, 0.2922],
  [2.15, 0.2892],
  [2.20, 0.2864],
  [2.25, 0.2835],
  [2.30, 0.2807],
  [2.35, 0.2779],
  [2.40, 0.2752],
  [2.45, 0.2725],
  [2.50, 0.2697],
  [2.55, 0.2670],
  [2.60, 0.2643],
  [2.65, 0.2615],
  [2.70, 0.2588],
  [2.75, 0.2561],
  [2.80, 0.2533],
  [2.85, 0.2506],
  [2.90, 0.2479],
  [2.95, 0.2451],
  [3.00, 0.2424],
  [3.10, 0.2368],
  [3.20, 0.2313],
  [3.30, 0.2258],
  [3.40, 0.2205],
  [3.50, 0.2154],
  [3.60, 0.2106],
  [3.70, 0.2060],
  [3.80, 0.2017],
  [3.90, 0.1975],
  [4.00, 0.1935],
  [4.20, 0.1861],
  [4.40, 0.1793],
  [4.60, 0.1730],
  [4.80, 0.1672],
  [5.00, 0.1618],
];

export const DRAG_TABLES: Record<DragModel, DragTable> = { G1, G7 };
