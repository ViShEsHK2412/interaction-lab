import type { Box } from './camera';
import { MEASURE } from './theme';

/**
 * Figma's Alt-hover measurement: select one frame, hold Alt, hover another,
 * and get the distances between them.
 *
 * The geometry is a port of Penpot's `calculate-distance-lines`, and it is
 * deliberately not rewritten as a set of cases. One 1-D ladder per axis
 * handles all three situations at once:
 *
 *   disjoint       one segment, the gap between the nearest edges
 *   overlapping    one segment, the part that protrudes
 *   contained      two segments, the padding at each end
 *
 * Writing that as `if (disjoint) ... else if (overlap) ...` looks clearer and
 * is where the bugs live, because the boundaries between the cases are exactly
 * where the arithmetic is subtle. The ladder has no boundaries.
 */

export interface Segment {
  axis: 'x' | 'y';
  /** Along the measured axis, in page units. */
  from: number;
  to: number;
  /** The cross-axis position the segment is drawn at. */
  at: number;
  /** What it measures, in page units. */
  value: number;
}

/** Start and end of a box on one axis. */
const span = (box: Box, axis: 'x' | 'y'): [number, number] => (axis === 'x'
  ? [box.x, box.x + box.width]
  : [box.y, box.y + box.height]);

/**
 * One axis of the ladder.
 *
 * `a` is the selected box, `b` the hovered one. The four comparisons below
 * produce every case without naming any of them: a segment is emitted wherever
 * one interval's edge sits inside the other.
 */
function distancesOn(a: Box, b: Box, axis: 'x' | 'y'): Array<[number, number]> {
  const [a0, a1] = span(a, axis);
  const [b0, b1] = span(b, axis);
  const out: Array<[number, number]> = [];

  if (a1 <= b0) out.push([a1, b0]);          // a entirely before b
  else if (b1 <= a0) out.push([b1, a0]);     // b entirely before a
  else {
    // They overlap. Emit each end where the selected box sits inside the
    // hovered one; a protruding end emits nothing on that side.
    if (a0 >= b0) out.push([b0, a0]);
    if (a1 <= b1) out.push([a1, b1]);
  }
  return out.filter(([from, to]) => to - from > 0.01);
}

/** Is the selected box entirely inside the hovered one on this axis? */
function containedOn(a: Box, b: Box, axis: 'x' | 'y'): boolean {
  const [a0, a1] = span(a, axis);
  const [b0, b1] = span(b, axis);
  return a0 >= b0 && a1 <= b1;
}

/**
 * Every segment between two boxes.
 *
 * Segments sit on the hovered box's centre line, except where the selected box
 * is entirely inside it on the other axis, in which case they sit on the
 * selected box's centre. That flip is Penpot's, and it is what stops a padding
 * measurement being drawn outside the thing it is measuring inside of.
 */
export function distanceLines(selected: Box, hovered: Box): Segment[] {
  const out: Segment[] = [];
  for (const axis of ['x', 'y'] as const) {
    const cross = axis === 'x' ? 'y' : 'x';
    const insideOnCross = containedOn(selected, hovered, cross);
    const host = insideOnCross ? selected : hovered;
    const at = cross === 'y'
      ? host.y + host.height / 2
      : host.x + host.width / 2;

    for (const [from, to] of distancesOn(selected, hovered, axis)) {
      out.push({ axis, from, to, at, value: to - from });
    }
  }
  return out;
}

/**
 * Where a dashed extension line is needed.
 *
 * Figma draws one when a segment's cross position misses the selected box, so
 * the measurement still visibly connects to the thing it measures. Penpot
 * skips these and relies on centre-anchoring alone; the dashes are the reason
 * a Figma measurement never looks like it is floating in space.
 *
 * Returns the span the dashes should cover on the cross axis, or null.
 */
export function extensionFor(segment: Segment, selected: Box): [number, number] | null {
  const cross = segment.axis === 'x' ? 'y' : 'x';
  const [s0, s1] = span(selected, cross);
  if (segment.at >= s0 && segment.at <= s1) return null;   // already touching
  return segment.at < s0 ? [segment.at, s0] : [s1, segment.at];
}

/**
 * Two decimals, trailing zeros stripped. Penpot's rule, and the right one: a
 * measurement reading `24.00` implies a precision the number does not have.
 */
export function formatDistance(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Paint the measurements onto a screen-space canvas.
 *
 * The lines are one pixel and the labels eleven, at every zoom, because they
 * are chrome. The *values* are page units, which is the whole point: what you
 * read is what you would type into a stylesheet, not what the screen happens
 * to be showing.
 */
export function paintMeasurements(
  ctx: CanvasRenderingContext2D,
  camera: { x: number; y: number; z: number },
  viewport: { width: number; height: number },
  selected: Box,
  hovered: Box,
  colour = MEASURE.line,
  chip = MEASURE.chip,
): void {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);

  const toScreenX = (v: number) => (v + camera.x) * camera.z;
  const toScreenY = (v: number) => (v + camera.y) * camera.z;

  ctx.font = '11px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'top';

  for (const segment of distanceLines(selected, hovered)) {
    const horizontal = segment.axis === 'x';
    const a = horizontal ? toScreenX(segment.from) : toScreenY(segment.from);
    const b = horizontal ? toScreenX(segment.to) : toScreenY(segment.to);
    const at = horizontal ? toScreenY(segment.at) : toScreenX(segment.at);

    // The dashed extension, drawn first so the solid line sits over it.
    const extension = extensionFor(segment, selected);
    if (extension) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      const e0 = horizontal ? toScreenY(extension[0]) : toScreenX(extension[0]);
      const e1 = horizontal ? toScreenY(extension[1]) : toScreenX(extension[1]);
      const mid = Math.round((a + b) / 2) + 0.5;
      if (horizontal) { ctx.moveTo(mid, e0); ctx.lineTo(mid, e1); }
      else { ctx.moveTo(e0, mid); ctx.lineTo(e1, mid); }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    const line = Math.round(at) + 0.5;
    if (horizontal) { ctx.moveTo(a, line); ctx.lineTo(b, line); }
    else { ctx.moveTo(line, a); ctx.lineTo(line, b); }
    // End caps, so a short segment is still visibly a measurement.
    const cap = 4;
    if (horizontal) {
      ctx.moveTo(Math.round(a) + 0.5, line - cap);
      ctx.lineTo(Math.round(a) + 0.5, line + cap);
      ctx.moveTo(Math.round(b) + 0.5, line - cap);
      ctx.lineTo(Math.round(b) + 0.5, line + cap);
    } else {
      ctx.moveTo(line - cap, Math.round(a) + 0.5);
      ctx.lineTo(line + cap, Math.round(a) + 0.5);
      ctx.moveTo(line - cap, Math.round(b) + 0.5);
      ctx.lineTo(line + cap, Math.round(b) + 0.5);
    }
    ctx.stroke();

    const label = formatDistance(segment.value);
    const w = ctx.measureText(label).width + 8;
    const cx = (a + b) / 2;
    // The chip, not the line: white on the line colour measures 3.67:1.
    ctx.fillStyle = chip;
    if (horizontal) {
      ctx.fillRect(Math.round(cx - w / 2), Math.round(at) - 17, w, 15);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, Math.round(cx - w / 2) + 4, Math.round(at) - 15);
    } else {
      ctx.fillRect(Math.round(at) + 4, Math.round(cx - 7), w, 15);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, Math.round(at) + 8, Math.round(cx - 5));
    }
  }
}
