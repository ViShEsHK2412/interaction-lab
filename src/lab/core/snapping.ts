import type { Box } from './camera';

/**
 * Snapping, which in Figma is two separate mechanisms working together rather
 * than the single grid snap people assume.
 *
 * *Snap to geometry* pulls the moving box's edges and centres onto the edges
 * and centres of everything else. *Snap to pixel grid* rounds whatever the
 * first one did not claim to whole page units. The second is what actually
 * kills the fractional drift you get from free dragging; the first is what
 * makes things line up with each other.
 *
 * All pure. The lab feeds it boxes and gets back a position and the lines to
 * draw, and never asks it about the DOM.
 */

/** Screen pixels, divided by zoom at the call site. The field agrees on 8. */
export const SNAP_TOLERANCE_PX = 8;

export type Axis = 'x' | 'y';

/** A line the snap matched on, in page units, for drawing. */
export interface SnapLine {
  axis: Axis;
  /** Where the line sits on its own axis. */
  at: number;
  /** How far it spans on the other axis, so it can be drawn end to end. */
  from: number;
  to: number;
}

export interface SnapResult {
  x: number;
  y: number;
  lines: SnapLine[];
}

/** Start, centre and end. Per axis that is all a bounding box offers. */
function candidates(box: Box, axis: Axis): number[] {
  return axis === 'x'
    ? [box.x, box.x + box.width / 2, box.x + box.width]
    : [box.y, box.y + box.height / 2, box.y + box.height];
}

const spanOf = (box: Box, axis: Axis): [number, number] => (axis === 'x'
  ? [box.y, box.y + box.height]
  : [box.x, box.x + box.width]);

/**
 * Solve one axis.
 *
 * X and Y are solved independently, which is what both tldraw and Excalidraw
 * do and is why a box can snap its left edge to one neighbour and its top to
 * another. Ties keep the first match; at the frame counts this deals with,
 * collecting every equal-distance line would be work for no visible gain.
 */
function snapAxis(
  moving: Box,
  others: readonly Box[],
  guides: readonly number[],
  axis: Axis,
  tolerance: number,
): { delta: number; lines: SnapLine[] } {
  const mine = candidates(moving, axis);
  let best: { delta: number; at: number; target: Box | null } | null = null;

  const consider = (from: number, to: number, target: Box | null) => {
    const delta = to - from;
    if (Math.abs(delta) > tolerance) return;
    if (best && Math.abs(delta) >= Math.abs(best.delta)) return;
    best = { delta, at: to, target };
  };

  for (const from of mine) {
    for (const other of others) {
      for (const to of candidates(other, axis)) consider(from, to, other);
    }
    // Ruler guides are snap targets too, which Figma documents and Penpot
    // implements: a guide you placed deliberately is at least as strong a
    // target as another frame's edge.
    for (const to of guides) consider(from, to, null);
  }

  if (!best) return { delta: 0, lines: [] };
  const hit = best as { delta: number; at: number; target: Box | null };

  // The line spans from the moving box to whatever it matched, so you can see
  // which thing it locked onto rather than just that something happened.
  const [ma, mb] = spanOf({ ...moving, x: moving.x + (axis === 'x' ? hit.delta : 0), y: moving.y + (axis === 'y' ? hit.delta : 0) }, axis);
  const [ta, tb] = hit.target ? spanOf(hit.target, axis) : [ma, mb];
  return {
    delta: hit.delta,
    lines: [{ axis, at: hit.at, from: Math.min(ma, ta), to: Math.max(mb, tb) }],
  };
}

/**
 * Where a dragged box should actually land.
 *
 * Geometry first, then whole-pixel rounding on any axis geometry did not
 * claim. `free` is the modifier bypass: Figma uses Control for this on both
 * platforms, and holding it mid-drag must drop the snap immediately rather
 * than at the next gesture.
 */
export function snapMovingBox(
  moving: Box,
  others: readonly Box[],
  guides: { x: readonly number[]; y: readonly number[] },
  tolerance: number,
  free = false,
): SnapResult {
  if (free) return { x: moving.x, y: moving.y, lines: [] };

  const sx = snapAxis(moving, others, guides.x, 'x', tolerance);
  const sy = snapAxis(moving, others, guides.y, 'y', tolerance);

  return {
    // Rounding is the half that stops fractional drift, and it only applies
    // where nothing better claimed the axis.
    x: sx.lines.length ? moving.x + sx.delta : Math.round(moving.x),
    y: sy.lines.length ? moving.y + sy.delta : Math.round(moving.y),
    lines: [...sx.lines, ...sy.lines],
  };
}

/**
 * Resizes get the rounding half only.
 *
 * Edge-to-edge smart snapping while resizing is a genuinely different problem:
 * the anchored edge must not move, so a naive snap on the dragged edge fights
 * the anchor. Deliberately not built rather than half-built.
 */
export function snapResizedBox(box: Box): Box {
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.max(1, Math.round(box.width)),
    height: Math.max(1, Math.round(box.height)),
  };
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** The smallest a frame may get. Below this the chrome has nowhere to live. */
export const MIN_FRAME = { width: 320, height: 240 };

/**
 * Apply a resize drag.
 *
 * The opposite edge stays put, which is the whole expectation of dragging an
 * edge: pulling the west edge left grows the box leftward and leaves the east
 * edge exactly where it was. That is why north and west adjust position as
 * well as size, and south and east only size.
 */
export function resizeBox(start: Box, handle: Handle, dx: number, dy: number): Box {
  let { x, y, width, height } = start;

  if (handle.includes('e')) width = start.width + dx;
  if (handle.includes('s')) height = start.height + dy;
  if (handle.includes('w')) {
    width = start.width - dx;
    x = start.x + dx;
  }
  if (handle.includes('n')) {
    height = start.height - dy;
    y = start.y + dy;
  }

  // Clamp without letting the anchored edge drift. Hitting the minimum while
  // dragging west must stop the west edge, not start pushing the east one.
  if (width < MIN_FRAME.width) {
    if (handle.includes('w')) x = start.x + start.width - MIN_FRAME.width;
    width = MIN_FRAME.width;
  }
  if (height < MIN_FRAME.height) {
    if (handle.includes('n')) y = start.y + start.height - MIN_FRAME.height;
    height = MIN_FRAME.height;
  }

  return { x, y, width, height };
}

/** Lay every box out in one evenly spaced row, sorted by where they already are. */
export function distributeRow(
  boxes: readonly (Box & { id: string })[],
  gap: number,
): Record<string, { x: number; y: number }> {
  const sorted = [...boxes].sort((a, b) => a.x - b.x);
  const top = Math.min(...sorted.map((b) => b.y));
  const out: Record<string, { x: number; y: number }> = {};
  let x = sorted[0]?.x ?? 0;
  for (const box of sorted) {
    out[box.id] = { x: Math.round(x), y: Math.round(top) };
    x += box.width + gap;
  }
  return out;
}
