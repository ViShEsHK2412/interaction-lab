import { describe, expect, it } from 'vitest';
import { formatTick, guideUnder, ruleAt, RULER_SIZE, tickStep, ticksFor } from './rulers';

describe('tickStep', () => {
  it('walks 1, 2, 5 through the powers of ten', () => {
    // Every result must be a nice number, at every zoom in between.
    for (let z = 0.02; z < 4; z *= 1.07) {
      const step = tickStep(z);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5, 10]).toContain(Math.round(mantissa));
    }
  });

  it('keeps labels at least the spacing apart', () => {
    for (const z of [0.05, 0.2, 0.5, 1, 2, 4]) {
      expect(tickStep(z, 56) * z).toBeGreaterThanOrEqual(56);
    }
  });

  it('grows the step as you zoom out, never shrinks it', () => {
    expect(tickStep(0.1)).toBeGreaterThan(tickStep(1));
    expect(tickStep(1)).toBeGreaterThan(tickStep(4));
  });

  it('gives round hundreds at 100%', () => {
    expect(tickStep(1, 56)).toBe(100);
  });
});

describe('ticksFor', () => {
  it('covers the whole rule and nothing past it', () => {
    const ticks = ticksFor(0, 1, 500);
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(t.at).toBeGreaterThanOrEqual(0);
      expect(t.at).toBeLessThanOrEqual(500);
    }
  });

  it('puts page zero at the origin when the camera is at zero', () => {
    const first = ticksFor(0, 1, 500)[0];
    expect(first).toMatchObject({ value: 0, at: 0, major: true });
  });

  it('reports page units, not screen ones', () => {
    // Zoomed to 2, a tick 100 page units along sits 200px down the rule.
    const t = ticksFor(0, 2, 900).find((x) => x.value === 100);
    expect(t?.at).toBe(200);
  });

  it('follows the camera', () => {
    // Camera -250 puts page 250 at the rule's origin.
    const first = ticksFor(-250, 1, 500)[0];
    expect(first?.value).toBeGreaterThanOrEqual(250);
  });

  it('marks the labelled ticks as major and the rest as minor', () => {
    const ticks = ticksFor(0, 1, 600);
    expect(ticks.filter((t) => t.major).map((t) => t.value)).toEqual([0, 100, 200, 300, 400, 500, 600]);
    expect(ticks.some((t) => !t.major)).toBe(true);
  });

  it('keeps the minor tier legible at every zoom, because the major step grows', () => {
    // The guard is not reachable at the default spacing: the labelled step is
    // always at least 56px apart, so a fifth of it is always at least 11.
    for (const z of [0.02, 0.05, 0.5, 1, 4]) {
      expect(ticksFor(0, z, 800).some((t) => !t.major)).toBe(true);
    }
  });

  it('drops the minor tier when a tight spacing would make it solid ink', () => {
    // Labels 10px apart leave the minor tier at 2, which is a grey band
    // rather than a set of ticks. At 15 the minor lands exactly on the 4px
    // floor and is kept, which is the boundary behaving as written.
    expect(ticksFor(0, 1, 800, 10).every((t) => t.major)).toBe(true);
    expect(ticksFor(0, 1, 800, 15).some((t) => !t.major)).toBe(true);
  });

  it('stays bounded at a pathological zoom', () => {
    expect(ticksFor(0, 0.0001, 1000).length).toBeLessThan(200);
  });
});

describe('formatTick', () => {
  it('drops the decimal tail floats grow', () => {
    expect(formatTick(0.30000000000000004)).toBe('0.3');
    expect(formatTick(100)).toBe('100');
    expect(formatTick(-250)).toBe('-250');
  });
});

describe('guideUnder', () => {
  const camera = { x: 0, y: 0, z: 1 };
  const guides = [
    { id: 1, axis: 'x' as const, at: 300 },
    { id: 2, axis: 'y' as const, at: 120 },
  ];

  it('finds a guide the pointer is near', () => {
    expect(guideUnder(guides, { x: 302, y: 999 }, camera)?.id).toBe(1);
  });

  it('ignores one the pointer is not near', () => {
    expect(guideUnder(guides, { x: 340, y: 999 }, camera)).toBeNull();
  });

  it('measures the tolerance in screen px, so zoom does not change the grab', () => {
    // At 4x, three page units is twelve screen px: out of reach.
    expect(guideUnder(guides, { x: 300 * 4 + 12, y: 0 }, { x: 0, y: 0, z: 4 })).toBeNull();
    expect(guideUnder(guides, { x: 300 * 4 + 3, y: 0 }, { x: 0, y: 0, z: 4 })?.id).toBe(1);
  });

  it('matches each guide on its own axis', () => {
    expect(guideUnder(guides, { x: 999, y: 121 }, camera)?.id).toBe(2);
  });
});

describe('ruleAt', () => {
  it('names the rule a point is in', () => {
    expect(ruleAt(400, 5)).toBe('y');       // top rule, drags out a horizontal
    expect(ruleAt(5, 400)).toBe('x');       // left rule, drags out a vertical
  });

  it('gives the corner to neither', () => {
    expect(ruleAt(4, 4)).toBeNull();
  });

  it('gives the canvas to neither', () => {
    expect(ruleAt(RULER_SIZE + 1, RULER_SIZE + 1)).toBeNull();
  });
});
