import { describe, expect, it } from 'vitest';
import {
  distributeRow, MIN_FRAME, resizeBox, snapMovingBox, snapResizedBox,
  SNAP_TOLERANCE_PX, type Handle,
} from './snapping';

const NO_GUIDES = { x: [] as number[], y: [] as number[] };
const box = (x: number, y: number, width = 100, height = 100) => ({ x, y, width, height });

describe('snapMovingBox, geometry', () => {
  const neighbour = box(0, 0, 200, 200);

  it('pulls a near edge onto the neighbour it is near', () => {
    const r = snapMovingBox(box(203, 400), [neighbour], NO_GUIDES, SNAP_TOLERANCE_PX);
    expect(r.x).toBe(200);
    expect(r.lines.some((l) => l.axis === 'x' && l.at === 200)).toBe(true);
  });

  it('leaves a box alone once it is outside the tolerance', () => {
    // 9 away, tolerance 8: no snap, so only the pixel rounding applies.
    const r = snapMovingBox(box(209, 400), [neighbour], NO_GUIDES, SNAP_TOLERANCE_PX);
    expect(r.x).toBe(209);
    expect(r.lines).toEqual([]);
  });

  it('matches centres, not only edges', () => {
    // The neighbour's centre is 100; a 100-wide box centred at 103 is 3 out.
    const r = snapMovingBox(box(53, 400), [neighbour], NO_GUIDES, SNAP_TOLERANCE_PX);
    expect(r.x + 50).toBe(100);
  });

  it('solves the axes independently, so a box can catch two different things', () => {
    const a = box(0, 0, 200, 200);
    const b = box(500, 640, 200, 200);
    const r = snapMovingBox(box(203, 637), [a, b], NO_GUIDES, SNAP_TOLERANCE_PX);
    expect(r.x).toBe(200);   // right of a
    expect(r.y).toBe(640);   // top of b
    expect(r.lines).toHaveLength(2);
  });

  it('takes the nearest of several candidates', () => {
    const near = box(210, 0, 100, 100);
    const far = box(196, 0, 100, 100);
    // 205 is 5 from 210 and 9 from 196: only the first is even in range.
    const r = snapMovingBox(box(205, 400), [near, far], NO_GUIDES, SNAP_TOLERANCE_PX);
    expect(r.x).toBe(210);
  });

  it('snaps to a ruler guide the same way it snaps to a frame', () => {
    const r = snapMovingBox(box(303, 400), [], { x: [300], y: [] }, SNAP_TOLERANCE_PX);
    expect(r.x).toBe(300);
  });
});

describe('snapMovingBox, the pixel half', () => {
  it('rounds an axis nothing else claimed, which is what kills drift', () => {
    const r = snapMovingBox(box(12.4, 88.7), [], NO_GUIDES, SNAP_TOLERANCE_PX);
    expect(r).toMatchObject({ x: 12, y: 89 });
  });

  it('does not round an axis a geometry snap already placed', () => {
    // The snap target is fractional, and honouring it beats rounding it away.
    const r = snapMovingBox(box(100.4, 5), [box(0, 0, 100.5, 10)], NO_GUIDES, SNAP_TOLERANCE_PX);
    expect(r.x).toBeCloseTo(100.5, 9);
  });
});

describe('snapMovingBox, the bypass', () => {
  it('leaves the box exactly where the pointer put it', () => {
    const r = snapMovingBox(box(203.7, 400.2), [box(0, 0, 200, 200)], NO_GUIDES, SNAP_TOLERANCE_PX, true);
    expect(r).toEqual({ x: 203.7, y: 400.2, lines: [] });
  });
});

describe('snap lines', () => {
  it('span from the moving box to what it matched', () => {
    const target = box(0, 0, 200, 200);
    const r = snapMovingBox(box(203, 400, 100, 100), [target], NO_GUIDES, SNAP_TOLERANCE_PX);
    const line = r.lines.find((l) => l.axis === 'x');
    // Target runs 0..200 on y, the moving box 400..500: the line covers both.
    expect(line).toMatchObject({ from: 0, to: 500 });
  });
});

describe('resizeBox', () => {
  const start = box(100, 100, 400, 300);

  it('grows east without moving the west edge', () => {
    expect(resizeBox(start, 'e', 50, 0)).toEqual({ x: 100, y: 100, width: 450, height: 300 });
  });

  it('grows west by moving the west edge and leaving the east one', () => {
    const r = resizeBox(start, 'w', -50, 0);
    expect(r.x).toBe(50);
    expect(r.width).toBe(450);
    expect(r.x + r.width).toBe(start.x + start.width);
  });

  it('grows north by moving the top and leaving the bottom', () => {
    const r = resizeBox(start, 'n', 0, -40);
    expect(r.y).toBe(60);
    expect(r.y + r.height).toBe(start.y + start.height);
  });

  it('handles a corner on both axes at once', () => {
    const r = resizeBox(start, 'nw', 20, 30);
    expect(r).toEqual({ x: 120, y: 130, width: 380, height: 270 });
  });

  it('stops at the minimum without dragging the anchored edge along', () => {
    // Pull the west edge far past the east one: the east edge must not move.
    const r = resizeBox(start, 'w', 900, 0);
    expect(r.width).toBe(MIN_FRAME.width);
    expect(r.x + r.width).toBe(start.x + start.width);
  });

  it('stops at the minimum height the same way from the north', () => {
    const r = resizeBox(start, 'n', 0, 900);
    expect(r.height).toBe(MIN_FRAME.height);
    expect(r.y + r.height).toBe(start.y + start.height);
  });

  it('clamps a south drag without touching the top', () => {
    const r = resizeBox(start, 's', 0, -900);
    expect(r.height).toBe(MIN_FRAME.height);
    expect(r.y).toBe(start.y);
  });

  it('covers all eight directions without throwing', () => {
    const handles: Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    for (const h of handles) {
      const r = resizeBox(start, h, 25, 25);
      expect(r.width).toBeGreaterThanOrEqual(MIN_FRAME.width);
      expect(r.height).toBeGreaterThanOrEqual(MIN_FRAME.height);
    }
  });
});

describe('snapResizedBox', () => {
  it('rounds everything to whole units and never below one', () => {
    expect(snapResizedBox({ x: 1.4, y: 2.6, width: 100.5, height: 0.2 }))
      .toEqual({ x: 1, y: 3, width: 101, height: 1 });
  });
});

describe('distributeRow', () => {
  it('lays them out left to right in the order they already sit', () => {
    const out = distributeRow([
      { id: 'b', x: 500, y: 40, width: 100, height: 100 },
      { id: 'a', x: 0, y: 90, width: 200, height: 100 },
    ], 32);
    expect(out['a']).toEqual({ x: 0, y: 40 });
    expect(out['b']).toEqual({ x: 232, y: 40 });
  });

  it('tops them all to the highest one', () => {
    const out = distributeRow([
      { id: 'a', x: 0, y: 300, width: 100, height: 100 },
      { id: 'b', x: 200, y: 120, width: 100, height: 100 },
    ], 20);
    expect(out['a']?.y).toBe(120);
    expect(out['b']?.y).toBe(120);
  });

  it('has nothing to say about nothing', () => {
    expect(distributeRow([], 32)).toEqual({});
  });
});
