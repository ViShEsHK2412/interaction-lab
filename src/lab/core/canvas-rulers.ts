import type { Camera, Size } from './camera';
import { formatTick, RULER_SIZE, ticksFor, type Guide } from './rulers';

/**
 * Painting the rules.
 *
 * On a canvas rather than in DOM, because a rule at 100% zoom on a wide screen
 * is a couple of hundred ticks, and two hundred divs repositioned on every
 * camera write is exactly the per-frame DOM churn the rest of this avoids.
 * Repainting a canvas is one call.
 */

export interface RulerColours {
  background: string;
  line: string;
  label: string;
  guide: string;
  band: string;
}

export const LIGHT_RULER: RulerColours = {
  background: 'rgb(255 255 255 / 0.92)',
  line: 'rgb(0 0 0 / 0.28)',
  label: 'rgb(0 0 0 / 0.55)',
  guide: '#f24822',
  band: 'rgb(13 153 255 / 0.18)',
};

export const DARK_RULER: RulerColours = {
  background: 'rgb(28 28 28 / 0.92)',
  line: 'rgb(255 255 255 / 0.28)',
  label: 'rgb(255 255 255 / 0.6)',
  guide: '#f24822',
  band: 'rgb(13 153 255 / 0.28)',
};

/** A frame's extent on each axis, shaded on the rules so a selection stays findable. */
export interface Band {
  x: [number, number];
  y: [number, number];
}

/**
 * Set the canvas up for a pass and clear it.
 *
 * Separate from the painting, because the layer is drawn in three passes and
 * only the first may clear: guide lines under the gutters, the gutters, then
 * the guide labels on top of them. A clear inside `paintRulers` erased the
 * lines that had just been drawn.
 */
export function beginRulerPass(
  ctx: CanvasRenderingContext2D,
  viewport: Size,
): void {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
}

export function paintRulers(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewport: Size,
  colours: RulerColours,
  bands: readonly Band[] = [],
): void {
  // The gutters themselves.
  ctx.fillStyle = colours.background;
  ctx.fillRect(0, 0, viewport.width, RULER_SIZE);
  ctx.fillRect(0, 0, RULER_SIZE, viewport.height);

  // A selected frame's extent, so you can still find it once it scrolls off.
  ctx.fillStyle = colours.band;
  for (const band of bands) {
    const x0 = (band.x[0] + camera.x) * camera.z;
    const x1 = (band.x[1] + camera.x) * camera.z;
    const y0 = (band.y[0] + camera.y) * camera.z;
    const y1 = (band.y[1] + camera.y) * camera.z;
    ctx.fillRect(x0, 0, x1 - x0, RULER_SIZE);
    ctx.fillRect(0, y0, RULER_SIZE, y1 - y0);
  }

  ctx.strokeStyle = colours.line;
  ctx.fillStyle = colours.label;
  ctx.lineWidth = 1;
  ctx.font = '10px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'top';

  // ── top rule ──────────────────────────────────────────────────────────────
  ctx.beginPath();
  for (const tick of ticksFor(camera.x, camera.z, viewport.width)) {
    if (tick.at < RULER_SIZE) continue;             // behind the corner
    // Half a pixel, so a 1px tick lands on the pixel grid rather than
    // straddling it. A blurry ruler is a contradiction.
    const at = Math.round(tick.at) + 0.5;
    ctx.moveTo(at, tick.major ? 4 : RULER_SIZE - 5);
    ctx.lineTo(at, RULER_SIZE);
    if (tick.major) ctx.fillText(formatTick(tick.value), at + 3, 3);
  }
  ctx.stroke();

  // ── left rule, labels turned to read up the page ─────────────────────────
  ctx.beginPath();
  for (const tick of ticksFor(camera.y, camera.z, viewport.height)) {
    if (tick.at < RULER_SIZE) continue;
    const at = Math.round(tick.at) + 0.5;
    ctx.moveTo(tick.major ? 4 : RULER_SIZE - 5, at);
    ctx.lineTo(RULER_SIZE, at);
  }
  ctx.stroke();
  for (const tick of ticksFor(camera.y, camera.z, viewport.height)) {
    if (tick.at < RULER_SIZE || !tick.major) continue;
    ctx.save();
    ctx.translate(3, Math.round(tick.at) - 3);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(formatTick(tick.value), 0, 0);
    ctx.restore();
  }

  // The corner, painted last so no tick runs under it.
  ctx.fillStyle = colours.background;
  ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE);
  ctx.strokeStyle = colours.line;
  ctx.beginPath();
  ctx.moveTo(0, RULER_SIZE - 0.5);
  ctx.lineTo(viewport.width, RULER_SIZE - 0.5);
  ctx.moveTo(RULER_SIZE - 0.5, 0);
  ctx.lineTo(RULER_SIZE - 0.5, viewport.height);
  ctx.stroke();
}

/**
 * Guides, drawn full-bleed across the canvas.
 *
 * On the same canvas as the rules but after them, so a guide passes under the
 * gutters rather than over the ticks.
 */
export function paintGuides(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewport: Size,
  guides: readonly Guide[],
  colours: RulerColours,
  activeId: number | null,
): void {
  for (const guide of guides) {
    const at = Math.round((guide.at + (guide.axis === 'x' ? camera.x : camera.y)) * camera.z) + 0.5;
    ctx.strokeStyle = colours.guide;
    ctx.lineWidth = guide.id === activeId ? 2 : 1;
    ctx.beginPath();
    if (guide.axis === 'x') {
      ctx.moveTo(at, 0);
      ctx.lineTo(at, viewport.height);
    } else {
      ctx.moveTo(0, at);
      ctx.lineTo(viewport.width, at);
    }
    ctx.stroke();
  }
}

/**
 * Each guide's position, in page units, in the gutter it belongs to.
 *
 * A third pass, after the gutters, because the gutters are opaque and would
 * paint straight over a label drawn with the lines.
 */
export function paintGuideLabels(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  guides: readonly Guide[],
  colours: RulerColours,
): void {
  ctx.font = '10px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  for (const guide of guides) {
    const at = Math.round((guide.at + (guide.axis === 'x' ? camera.x : camera.y)) * camera.z);
    const label = formatTick(guide.at);
    const w = ctx.measureText(label).width + 6;
    ctx.fillStyle = colours.guide;
    if (guide.axis === 'x') {
      ctx.fillRect(at + 1, 2, w, 13);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, at + 4, 4);
    } else {
      ctx.fillRect(2, at + 1, 13, w);
      ctx.fillStyle = '#fff';
      ctx.save();
      ctx.translate(4, at + w - 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
}
