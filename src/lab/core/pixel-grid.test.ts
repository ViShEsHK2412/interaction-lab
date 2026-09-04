import { describe, expect, it } from 'vitest';
import {
  contrastRatio, firstLine, gridAlpha, isLight, MIN_PERIOD_PX, parseColour,
  pickReadable, PIXEL_GRID_STEP,
} from './pixel-grid';

describe('gridAlpha', () => {
  it('draws at full strength when the lines have room', () => {
    expect(gridAlpha(PIXEL_GRID_STEP, 1, 0.09)).toBe(0.09);
  });

  it('stops entirely once the lines are closer than the threshold', () => {
    // A grid this dense is a wash, not a grid.
    expect(gridAlpha(PIXEL_GRID_STEP, 0.5, 0.09)).toBe(0);
    expect(gridAlpha(PIXEL_GRID_STEP, MIN_PERIOD_PX / PIXEL_GRID_STEP, 0.09)).toBe(0);
  });

  it('fades rather than blinking out', () => {
    // Between the threshold and full strength there is a real ramp.
    const mid = gridAlpha(PIXEL_GRID_STEP, 0.9, 0.09);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.09);
  });

  it('is monotonic as you zoom out', () => {
    const a = gridAlpha(PIXEL_GRID_STEP, 1.4, 0.09);
    const b = gridAlpha(PIXEL_GRID_STEP, 0.95, 0.09);
    const c = gridAlpha(PIXEL_GRID_STEP, 0.85, 0.09);
    expect(a).toBeGreaterThanOrEqual(b);
    expect(b).toBeGreaterThanOrEqual(c);
  });
});

describe('firstLine', () => {
  it('finds the first line at or after the viewport edge', () => {
    // Camera 0 means page 0 is at the left edge.
    expect(firstLine(0, 10)).toBe(0);
    // Camera -37 puts page 37 at the edge, so the first line is 40.
    expect(firstLine(-37, 10)).toBe(40);
  });

  it('handles a camera on the other side of the origin', () => {
    expect(firstLine(37, 10)).toBe(-30);
  });
});

describe('isLight', () => {
  it('calls a pale canvas light and a dark one dark', () => {
    expect(isLight({ r: 241, g: 241, b: 241 })).toBe(true);
    expect(isLight({ r: 28, g: 28, b: 28 })).toBe(false);
  });

  it('weights green the way perception does', () => {
    // Same numeric value, and green reads as light where blue does not.
    expect(isLight({ r: 0, g: 230, b: 0 })).toBe(true);
    expect(isLight({ r: 0, g: 0, b: 230 })).toBe(false);
  });
});

describe('parseColour', () => {
  it('reads both hex lengths', () => {
    expect(parseColour('#f1f1f1')).toEqual({ r: 241, g: 241, b: 241 });
    expect(parseColour('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('reads rgb in either separator style', () => {
    expect(parseColour('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseColour('rgb(1 2 3 / 0.5)')).toEqual({ r: 1, g: 2, b: 3 });
  });

  it('gives nothing rather than a guess for anything else', () => {
    expect(parseColour('rebeccapurple')).toBeNull();
    expect(parseColour('')).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('gives 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 2);
    expect(contrastRatio({ r: 128, g: 128, b: 128 }, { r: 128, g: 128, b: 128 })).toBeCloseTo(1, 9);
  });

  it('does not care which way round the pair is given', () => {
    const a = { r: 13, g: 153, b: 255 };
    const b = { r: 241, g: 241, b: 241 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 9);
  });
});

describe('pickReadable', () => {
  // Muted first, the extremes last, which is the order preference runs in.
  const CHROME = ['#5a5a5a', '#b4b4b4', '#000000', '#ffffff'];

  it('clears 4.5:1 against every background, including the hostile mid tones', () => {
    // #808080 is the case a binary light-or-dark flip cannot solve: it is
    // hostile to both a dark grey and a light grey, and only an extreme wins.
    for (const bg of ['#ffffff', '#f1f1f1', '#c0c0c0', '#808080', '#606060', '#2b2b2b', '#000000']) {
      const picked = pickReadable(bg, CHROME);
      const ratio = contrastRatio(parseColour(picked)!, parseColour(bg)!);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the muted grey wherever it is good enough', () => {
    expect(pickReadable('#f1f1f1', CHROME)).toBe('#5a5a5a');
    expect(pickReadable('#000000', CHROME)).toBe('#b4b4b4');
  });

  it('reaches for an extreme only where it has to', () => {
    expect(pickReadable('#808080', CHROME)).toBe('#000000');
  });

  it('falls back to the closest it has rather than to nothing', () => {
    // Nothing in this list clears the floor against mid grey.
    expect(pickReadable('#808080', ['#8a8a8a', '#767676'])).toBe('#767676');
  });

  it('falls back to the first candidate when the background will not parse', () => {
    expect(pickReadable('not-a-colour', CHROME)).toBe('#5a5a5a');
  });
});
