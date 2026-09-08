/**
 * The camera: about a hundred lines of arithmetic, owned rather than imported.
 *
 * Two halves, deliberately separated. Everything above `createCameraStore` is
 * pure and knows nothing about the DOM, so the fixed-point zoom, the fit maths
 * and the tick stepping can all be tested without a browser. The store below
 * is the only stateful part, and it is a ref with subscribers rather than React
 * state: a camera that re-renders React on every wheel event is a camera that
 * drops frames, and the whole architecture rests on it not doing that.
 */

export interface Camera {
  x: number;
  y: number;
  /** Zoom. `1` means one page unit per CSS pixel. */
  z: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * The zoom stops the keyboard steps between, and the interactive clamp.
 *
 * The first and last are the floor and ceiling for gestures. Fitting is allowed
 * below the floor, which is deliberate and explained at `zoomToBounds`.
 */
export const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 4] as const;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/**
 * The page point currently under a screen point.
 *
 * `screen` is relative to the canvas element, not the window: the caller
 * subtracts the cached canvas rect before calling, because reading that rect
 * inside a pointermove is the single easiest way to make a canvas stutter.
 */
export function screenToPage(screen: number, camera: number, z: number): number {
  return screen / z - camera;
}

export function pageToScreen(page: number, camera: number, z: number): number {
  return (page + camera) * z;
}

/**
 * Zoom about a fixed point: the page point under `screen` must not move.
 *
 * Solving `screen/z1 - c1 = screen/z2 - c2` for c2 gives this. Every "zoom to
 * the cursor" gesture in the app is this one line; getting it wrong is what
 * makes a canvas feel like it is fighting you.
 */
export function zoomAbout(camera: Camera, screenX: number, screenY: number, z2: number): Camera {
  const z = clamp(z2, MIN_ZOOM, MAX_ZOOM);
  return {
    x: camera.x + screenX / z - screenX / camera.z,
    y: camera.y + screenY / z - screenY / camera.z,
    z,
  };
}

/**
 * A wheel delta as a multiplicative zoom factor.
 *
 * Multiplicative, never additive: a fixed increment is a huge jump at z=0.05
 * and imperceptible at z=4, so additive zoom feels broken at both ends and
 * correct only in the middle. The clamp tames hi-resolution wheels that report
 * hundreds of units per notch.
 */
export function wheelZoom(z: number, deltaY: number, deltaMode = 0): number {
  // deltaMode 1 is lines, not pixels. Roughly 16px a line, per the UI Events note.
  const px = deltaMode === 1 ? deltaY * 16 : deltaY;
  const delta = clamp(px, -10, 10) / 100;
  return clamp(z * (1 - delta), MIN_ZOOM, MAX_ZOOM);
}

/** The next stop up or down from here, for keyboard zoom. */
export function stepZoom(z: number, direction: 1 | -1): number {
  const eps = 1e-4;
  if (direction > 0) return ZOOM_STEPS.find((s) => s > z + eps) ?? MAX_ZOOM;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i -= 1) {
    const s = ZOOM_STEPS[i]!;
    if (s < z - eps) return s;
  }
  return MIN_ZOOM;
}

/** The smallest box containing all of them, or null when there are none. */
export function boundsOf(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  let minX = Infinity; let minY = Infinity;
  let maxX = -Infinity; let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The fit floor, below the interactive minimum on purpose. See `zoomToBounds`. */
export const FIT_MIN_ZOOM = 0.02;

/**
 * The camera that frames `box` inside `viewport`, centred.
 *
 * Two deliberate asymmetries. Fitting never zooms past 100%, because blowing a
 * single small frame up to fill the window is not what "fit" means to anyone.
 * And its floor sits *below* the interactive minimum: with many screens and a
 * narrow window (devtools docked down the side), being able to see everything
 * matters more than the gesture floor, which exists to stop you losing the
 * canvas by scrolling.
 */
export function zoomToBounds(box: Box, viewport: Size, insetOverride?: number): Camera {
  const inset = insetOverride ?? Math.min(96, viewport.width * 0.28);
  const usableW = Math.max(1, viewport.width - inset * 2);
  const usableH = Math.max(1, viewport.height - inset * 2);
  const z = clamp(
    Math.min(usableW / Math.max(1, box.width), usableH / Math.max(1, box.height)),
    FIT_MIN_ZOOM,
    1,
  );
  // Centre: the page point at the viewport centre should be the box's centre.
  return {
    x: viewport.width / 2 / z - (box.x + box.width / 2),
    y: viewport.height / 2 / z - (box.y + box.height / 2),
    z,
  };
}

/** Where the viewport's centre currently sits, in page units. */
export function viewportCentre(camera: Camera, viewport: Size): { x: number; y: number } {
  return {
    x: screenToPage(viewport.width / 2, camera.x, camera.z),
    y: screenToPage(viewport.height / 2, camera.y, camera.z),
  };
}

/** A camera whose viewport centre is `point`, at zoom `z`. */
export function cameraCentredOn(point: { x: number; y: number }, z: number, viewport: Size): Camera {
  return {
    x: viewport.width / 2 / z - point.x,
    y: viewport.height / 2 / z - point.y,
    z,
  };
}

/**
 * `easeOutQuint`, the JS twin of `cubic-bezier(0.22, 1, 0.36, 1)`.
 *
 * Camera animation cannot be a CSS transition: the transform is written
 * imperatively every frame, and handing the same property to CSS means the two
 * fight and the canvas jitters. So the curve has to exist in JS.
 */
export function easeOutQuint(t: number): number {
  return 1 - (1 - t) ** 5;
}

/**
 * Interpolate one camera towards another.
 *
 * Zoom is interpolated in log space, and that is not a flourish. Zoom is
 * multiplicative, so a linear walk from 0.1 to 1 spends most of its time
 * already zoomed in and lurches at the start; in log space every step feels
 * the same size. The viewport centre is what actually travels, so the pan is
 * expressed as the centre point moving rather than as x/y, which otherwise
 * swing wildly when z changes.
 */
export function lerpCamera(from: Camera, to: Camera, t: number, viewport: Size): Camera {
  const e = easeOutQuint(clamp(t, 0, 1));
  const z = Math.exp(Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * e);
  const a = viewportCentre(from, viewport);
  const b = viewportCentre(to, viewport);
  return cameraCentredOn(
    { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e },
    z,
    viewport,
  );
}

/**
 * The page-space rectangle currently visible, grown by `margin` as a fraction
 * of its own size. Culling asks this and then tests each frame against it.
 */
export function visibleBounds(camera: Camera, viewport: Size, margin = 0.25): Box {
  const w = viewport.width / camera.z;
  const h = viewport.height / camera.z;
  return {
    x: -camera.x - w * margin,
    y: -camera.y - h * margin,
    width: w * (1 + margin * 2),
    height: h * (1 + margin * 2),
  };
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Round to whole device pixels, so an idle canvas rasterises crisply. */
export function snapToDevicePixels(v: number, dpr: number): number {
  return Math.round(v * dpr) / dpr;
}

/** tldraw's `toDomPrecision`: four decimals is past what any display resolves. */
export function toDomPrecision(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

// ── The store ───────────────────────────────────────────────────────────────

/**
 * Where the frame's own control sits, in screen pixels.
 *
 * The button hangs off the frame's top-right corner, so its place depends on
 * where that corner is *on screen* — which is not always where the camera says
 * the layout puts it. In fill mode the frame is stretched to the viewport and
 * the camera is parked at its origin, so the corner is the viewport's own
 * top-right; deriving it from the layout width instead put the button past the
 * right edge of a window narrower than the frame, where it could not be
 * clicked. Entering fill worked and leaving it did not, unless you knew the
 * shortcut.
 *
 * `reach` is the least distance from the top of the viewport the button can
 * sit at. Above that it hangs over the frame; below it, it tucks inside.
 */
export function playButtonAt(
  box: Box,
  camera: Camera,
  fill: Size | null,
  reach: number,
): { x: number; y: number; inside: boolean } {
  const right = fill ? fill.width : pageToScreen(box.x + box.width, camera.x, camera.z);
  const top = fill ? 0 : pageToScreen(box.y, camera.y, camera.z);
  return { x: right, y: Math.max(top, reach), inside: top < reach };
}

export interface CameraStore {
  get(): Camera;
  /** Write the value. Subscribers are notified synchronously; DOM work is theirs to schedule. */
  set(next: Camera): void;
  subscribe(fn: (camera: Camera) => void): () => void;
}

/**
 * A ref with subscribers, not React state.
 *
 * The React working group's own guidance is that an external store read at
 * gesture frequency de-optimises concurrent rendering permanently, and every
 * canvas that routes its camera through a store-and-render loop is the
 * documented janky example. So the camera never renders anything: it notifies,
 * and the listeners write DOM.
 */
export function createCameraStore(initial: Camera): CameraStore {
  let camera = initial;
  const listeners = new Set<(camera: Camera) => void>();
  return {
    get: () => camera,
    set(next) {
      camera = next;
      for (const fn of listeners) fn(camera);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}
