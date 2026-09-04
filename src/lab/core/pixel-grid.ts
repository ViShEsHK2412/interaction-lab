import type { Camera, Size } from './camera';

/**
 * The pixel grid: one uniform texture in page units, painted in screen space.
 *
 * One tier, deliberately. A first version layered a coarser "major" tier over
 * the fine one, the way a lot of canvas tools do, and it was worse: the grid
 * has to read as a single texture you can look through, and two overlaid grids
 * read as two grids. Figma's own pixel grid is one tier and fades out rather
 * than getting denser.
 */

/** Page units between lines. Ten is a 10px grid at 100%. */
export const PIXEL_GRID_STEP = 10;
/** Below this many screen px apart, a grid stops being a grid and becomes a wash. */
export const MIN_PERIOD_PX = 8;
/**
 * The band the fade happens over, above the threshold.
 *
 * Two, not six, and the difference matters: with a 10-unit step and a band of
 * six, the grid was still only a third drawn at 100% zoom, which is precisely
 * where a pixel grid should be at its most useful. Two puts full strength at
 * exactly 100% and takes the grid away below about 80%, where the lines really
 * are too close to read as lines.
 */
export const FADE_RANGE_PX = 2;

/**
 * How strongly to draw the grid, 0 for not at all.
 *
 * Fades out as the lines crowd together rather than cutting off, because a
 * grid that vanishes between one wheel notch and the next reads as a glitch.
 * Pure.
 */
export function gridAlpha(step: number, zoom: number, base: number): number {
  const period = step * zoom;
  if (period <= MIN_PERIOD_PX) return 0;
  if (period >= MIN_PERIOD_PX + FADE_RANGE_PX) return base;
  return base * ((period - MIN_PERIOD_PX) / FADE_RANGE_PX);
}

/**
 * The first grid line at or after the viewport's left edge, in page units.
 * Everything after it is `step` further along.
 */
export function firstLine(cameraOffset: number, step: number): number {
  // The `+ 0` normalises negative zero, which is not merely cosmetic: it reads
  // as a different value to anything comparing with Object.is.
  return Math.ceil(-cameraOffset / step) * step + 0;
}

/**
 * Is this background light enough that the grid should be drawn dark?
 *
 * Rec. 601 luma, which is what the field uses for this decision. The grid has
 * to contrast with whatever colour the canvas has been set to, and a fixed
 * grey disappears against half of them.
 */
export function isLight(rgb: { r: number; g: number; b: number }): boolean {
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255 >= 0.5;
}

export function parseColour(value: string): { r: number; g: number; b: number } | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const h = hex[1]!;
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (!rgb) return null;
  const parts = rgb[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
  const [r, g, b] = parts;
  if (r === undefined || g === undefined || b === undefined) return null;
  return { r, g, b };
}

/**
 * Paint the grid onto a screen-space canvas.
 *
 * Screen space, not the transformed layer: a grid inside the layer would be
 * scaled with everything else, so its lines would thicken as you zoom in and
 * disappear as you zoom out, which is the opposite of what a reference grid is
 * for. The values are page units; the drawing is pixels.
 */
export function paintPixelGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewport: Size,
  options: { step?: number; alpha?: number; light?: boolean } = {},
): void {
  const dpr = window.devicePixelRatio || 1;
  const step = options.step ?? PIXEL_GRID_STEP;
  const alpha = gridAlpha(step, camera.z, options.alpha ?? 0.09);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  if (alpha <= 0) return;

  ctx.strokeStyle = options.light === false
    ? `rgb(255 255 255 / ${alpha})`
    : `rgb(0 0 0 / ${alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();

  const period = step * camera.z;
  // Half a pixel, so a 1px line lands on the pixel grid instead of straddling
  // it. A blurry reference grid is worse than none.
  let x = (firstLine(camera.x, step) + camera.x) * camera.z;
  for (; x <= viewport.width; x += period) {
    const at = Math.round(x) + 0.5;
    ctx.moveTo(at, 0);
    ctx.lineTo(at, viewport.height);
  }
  let y = (firstLine(camera.y, step) + camera.y) * camera.z;
  for (; y <= viewport.height; y += period) {
    const at = Math.round(y) + 0.5;
    ctx.moveTo(0, at);
    ctx.lineTo(viewport.width, at);
  }
  ctx.stroke();
}
