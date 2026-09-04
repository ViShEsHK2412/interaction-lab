import { describe, expect, it } from 'vitest';
import {
  firstLine, gridAlpha, isLight, MIN_PERIOD_PX, parseColour, PIXEL_GRID_STEP,
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
