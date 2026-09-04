/**
 * Canvas rulers and guides, in page units.
 *
 * The distinction that matters: these are *canvas-true*, not viewport rulers.
 * A viewport ruler measures the window, so its ticks are window pixels and its
 * guides drift off the content the moment you pan or zoom. Here the tick
 * values are page units re-derived from the camera on every write, and a guide
 * is stored as a page coordinate and drawn at `(pos + camera) * z`. Everything
 * stays glued to the content at every zoom, which is what makes a guide worth
 * placing at all.
 *
 * Pure. The lab feeds it a camera and a viewport and gets back numbers.
 */

/** Ruler thickness in screen px, shared by what draws it and what dodges it. */
export const RULER_SIZE = 22;
/** How near a guide has to be, in screen px, to be grabbed. */
export const GUIDE_GRAB_PX = 5;

export type Axis = 'x' | 'y';

export interface Guide {
  id: number;
  axis: Axis;
  /** Page units, which is why it stays with the content. */
  at: number;
}

/**
 * The nicest round step at least `minSpacing` screen pixels apart.
 *
 * d3's shape: walk 1, 2, 5 through the powers of ten. Penpot ships a
 * hand-tuned table instead, with 25 where this has 20; d3's derivation is the
 * canonical one and generalises rather than running out at the ends. Pure.
 */
export function tickStep(zoom: number, minSpacing = 56): number {
  const wanted = minSpacing / zoom;                 // page units per label
  const magnitude = 10 ** Math.floor(Math.log10(wanted));
  for (const multiple of [1, 2, 5, 10]) {
    if (magnitude * multiple >= wanted) return magnitude * multiple;
  }
  return magnitude * 10;
}

export interface Tick {
  /** Page units, which is what the label reads. */
  value: number;
  /** Screen px along the rule. */
  at: number;
  major: boolean;
}

/**
 * Every tick visible along one axis.
 *
 * Minor ticks at a fifth of the labelled step, which is what gives a ruler
 * something to count against between labels. Anything denser than about four
 * screen pixels is dropped: a rule of solid ink measures nothing.
 */
export function ticksFor(
  cameraOffset: number,
  zoom: number,
  length: number,
  minSpacing = 56,
): Tick[] {
  const major = tickStep(zoom, minSpacing);
  const minor = major / 5;
  const step = minor * zoom >= 4 ? minor : major;

  const first = Math.floor(-cameraOffset / step) * step;
  const out: Tick[] = [];
  // Guard against a pathological zoom producing millions of ticks.
  const limit = Math.ceil(length / Math.max(1, step * zoom)) + 2;
  for (let i = 0; i <= limit; i += 1) {
    const value = first + i * step;
    const at = (value + cameraOffset) * zoom;
    if (at > length) break;
    if (at >= 0) {
      // Modulo on floats drifts, so compare against a rounded multiple.
      const isMajor = Math.abs(value / major - Math.round(value / major)) < 1e-6;
      out.push({ value, at, major: isMajor });
    }
  }
  return out;
}

/**
 * Tick labels drop their trailing zeros and never grow a long decimal tail.
 *
 * At deep zoom the step is fractional, and `0.30000000000000004` on a ruler is
 * worse than no label.
 */
export function formatTick(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

/** The guide nearest a screen point on its own axis, or null. */
export function guideUnder(
  guides: readonly Guide[],
  screen: { x: number; y: number },
  camera: { x: number; y: number; z: number },
  tolerance = GUIDE_GRAB_PX,
): Guide | null {
  let best: Guide | null = null;
  let bestGap = tolerance;
  for (const g of guides) {
    const at = (g.at + (g.axis === 'x' ? camera.x : camera.y)) * camera.z;
    const gap = Math.abs(at - (g.axis === 'x' ? screen.x : screen.y));
    if (gap <= bestGap) { best = g; bestGap = gap; }
  }
  return best;
}

/**
 * Which rule a screen point is in, if any.
 *
 * The axis a drag produces is implied by the rule it started from: down from
 * the top rule gives a horizontal guide, right from the left rule a vertical
 * one. The corner belongs to neither.
 */
export function ruleAt(x: number, y: number): Axis | null {
  if (x < RULER_SIZE && y < RULER_SIZE) return null;   // the corner
  if (y < RULER_SIZE) return 'y';                      // top rule
  if (x < RULER_SIZE) return 'x';                      // left rule
  return null;
}

const KEY = 'interaction-lab:guides:v1';

/** Guides live per project, not per session, and are validated on read. */
export function loadGuides(): Guide[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: Guide[] = [];
    for (const item of data) {
      if (typeof item !== 'object' || item === null) continue;
      const { axis, at } = item as { axis?: unknown; at?: unknown };
      if ((axis !== 'x' && axis !== 'y') || typeof at !== 'number' || !Number.isFinite(at)) continue;
      out.push({ id: out.length + 1, axis, at });
    }
    return out;
  } catch {
    return [];
  }
}

export function saveGuides(guides: readonly Guide[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(guides.map((g) => ({ axis: g.axis, at: g.at }))));
  } catch { /* quota or disabled */ }
}
