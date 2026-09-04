import { describe, expect, it } from 'vitest';
import { ACCENT, DANGER, GROUND, LADDER, MEASURE, MOTION, SPACE, TYPE } from './theme';

/**
 * The tokens carry contrast measurements in their comments, and a comment
 * cannot fail. These recompute them.
 *
 * Every one of these numbers is why a value is what it is: the accent is split
 * into a line step and a solid step *because* white on the line step measures
 * 2.99:1, and if someone later collapses them back into one token the reason
 * has to reappear as a failing test rather than as a control nobody can read.
 */

const channel = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: number[]): number =>
  0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);

function contrast(a: number[], b: number[]): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** White laid over a ground at `alpha`, which is how every surface is built. */
const film = (alpha: number, ground: number[]): number[] =>
  ground.map((v) => 255 * alpha + v * (1 - alpha));

const WHITE = [255, 255, 255];
const g = hex(GROUND);

describe('text on the ground', () => {
  it('clears 4.5:1 at all three levels', () => {
    expect(contrast(film(0.9, g), g)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(film(0.6, g), g)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(film(0.46, g), g)).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The constraint align-ui never had to state. Its panels are one surface;
   * here a HUD button raises on hover, and tertiary does not survive the trip.
   */
  it('tertiary does not survive a raised surface, which is why hover uses primary', () => {
    const raised = film(LADDER[1], g);
    expect(contrast(film(0.46, raised), raised)).toBeLessThan(4.5);
    expect(contrast(film(0.9, raised), raised)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the accent is two steps for a measured reason', () => {
  it('white fails on the line step and passes on the solid one', () => {
    expect(contrast(WHITE, hex(ACCENT.line))).toBeLessThan(4.5);
    expect(contrast(WHITE, hex(ACCENT.solid))).toBeGreaterThanOrEqual(4.5);
  });

  it('the line step still reads as a graphic on the dark ground', () => {
    expect(contrast(hex(ACCENT.line), g)).toBeGreaterThanOrEqual(3);
  });

  /**
   * And the case the casing exists for: on a mid grey the line step is gone.
   * If this ever starts passing, the casing has stopped earning its place.
   */
  it('the line step vanishes on a mid grey, which is what the casing answers', () => {
    expect(contrast(hex(ACCENT.line), [128, 128, 128])).toBeLessThan(3);
  });
});

describe('measurement red is split the same way', () => {
  it('white fails on the line and passes on the chip', () => {
    expect(contrast(WHITE, hex(MEASURE.line))).toBeLessThan(4.5);
    expect(contrast(WHITE, hex(MEASURE.chip))).toBeGreaterThanOrEqual(4.5);
  });

  it('the danger hue is a glyph on the ground, so it needs 3:1 and gets it', () => {
    expect(contrast(hex(DANGER), g)).toBeGreaterThanOrEqual(3);
  });
});

describe('the scales', () => {
  it('spacing doubles and stays on four steps', () => {
    expect(Object.values(SPACE)).toEqual([4, 8, 12, 16]);
  });

  it('type bottoms out at 11px, because every number here is read', () => {
    expect(Math.min(...Object.values(TYPE))).toBe(11);
  });

  it('nothing animates past the 300ms ceiling for a triggered change', () => {
    for (const value of Object.values(MOTION)) {
      const ms = Number(/^(\d+)ms/.exec(value)?.[1]);
      expect(ms).toBeLessThanOrEqual(300);
    }
  });

  it('the exit curve accelerates and the ui curve settles', () => {
    // The second control point's y is what separates them: 1 runs into the
    // stop at full speed, 0 arrives already slowed.
    expect(MOTION.exit).toContain('1, 1)');
    expect(MOTION.ui).toContain('0, 1)');
  });
});
