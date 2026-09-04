import {
  clamp, pageToScreen, screenToPage, toDomPrecision, wheelZoom, zoomAbout,
  type Camera, type CameraStore, type Size,
} from './camera';

/**
 * Wheel, pointer and pinch bindings for explore mode.
 *
 * Bound imperatively to the canvas root rather than through React props,
 * because every one of these fires at gesture frequency and none of them may
 * cause a render. The whole file talks to the camera store and to DOM, and
 * never to React.
 */

export interface CanvasInputOptions {
  camera: CameraStore;
  /** The canvas rect, cached by the caller. Never read the DOM in here. */
  rect: () => DOMRect;
  viewport: () => Size;
  /** True while a gesture should not pan the canvas, e.g. locked into a screen. */
  locked: () => boolean;
  /** Told when a gesture starts and ends, for the will-change dance and culling. */
  onGestureStart: () => void;
  onGestureEnd: () => void;
}

/** Pointer position relative to the canvas, which is what the camera maths wants. */
function local(e: { clientX: number; clientY: number }, rect: DOMRect) {
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

export function bindCanvasInput(root: HTMLElement, opts: CanvasInputOptions): () => void {
  const { camera, rect, locked, onGestureStart, onGestureEnd } = opts;

  /**
   * Trackpad pinch arrives as a wheel event with ctrlKey set. That is also how
   * the browser's own page zoom is triggered, so preventDefault is not
   * optional: without it the page zooms underneath the canvas zoom and the two
   * fight, which moves the fixed HUD around and looks like a bug in the lab.
   */
  const onWheel = (e: WheelEvent) => {
    if (locked()) return;
    e.preventDefault();
    const p = local(e, rect());
    const c = camera.get();

    if (e.ctrlKey || e.metaKey) {
      camera.set(zoomAbout(c, p.x, p.y, wheelZoom(c.z, e.deltaY, e.deltaMode)));
      return;
    }

    // Shift turns a vertical wheel into horizontal panning, the way every
    // scrollable surface does. A trackpad already sends deltaX, so both add.
    const scale = e.deltaMode === 1 ? 16 : 1;
    const dx = (e.shiftKey ? e.deltaY : e.deltaX) * scale;
    const dy = (e.shiftKey ? 0 : e.deltaY) * scale;
    camera.set({ ...c, x: c.x - dx / c.z, y: c.y - dy / c.z });
  };

  // ── Panning ───────────────────────────────────────────────────────────────
  let panning: number | null = null;
  let last = { x: 0, y: 0 };
  let spaceHeld = false;

  const startPan = (e: PointerEvent) => {
    panning = e.pointerId;
    last = { x: e.clientX, y: e.clientY };
    root.setPointerCapture(e.pointerId);
    root.dataset['panning'] = '';
    onGestureStart();
  };

  const endPan = () => {
    if (panning === null) return;
    try { root.releasePointerCapture(panning); } catch { /* already gone */ }
    panning = null;
    delete root.dataset['panning'];
    onGestureEnd();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (locked()) return;
    // Middle button, space held, or a press that landed on the canvas itself.
    // A press on a frame is the frame's gesture and never reaches here.
    const onEmpty = e.target === root || (e.target as HTMLElement).dataset['canvasBackground'] !== undefined;
    if (e.button === 1 || spaceHeld || (e.button === 0 && onEmpty)) {
      e.preventDefault();
      startPan(e);
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (panning !== e.pointerId) return;
    const c = camera.get();
    camera.set({
      ...c,
      x: c.x + (e.clientX - last.x) / c.z,
      y: c.y + (e.clientY - last.y) / c.z,
    });
    last = { x: e.clientX, y: e.clientY };
  };

  // ── Touch pinch ───────────────────────────────────────────────────────────
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; z: number } | null = null;

  const onTouchDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || locked()) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      endPan();
      const [a, b] = [...touches.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), z: camera.get().z };
      onGestureStart();
    }
  };

  const onTouchMove = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
    const prev = [...touches.values()].map((t) => ({ ...t }));
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size !== 2 || !pinch) return;
    const [a, b] = [...touches.values()] as [{ x: number; y: number }, { x: number; y: number }];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (distance < 1) return;

    const r = rect();
    const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
    const c = camera.get();

    // Zoom about the midpoint, then pan by however far the midpoint itself
    // travelled, so a two-finger drag pinches and moves at the same time.
    const zoomed = zoomAbout(c, mid.x, mid.y, clamp(pinch.z * (distance / pinch.distance), 0.02, 4));
    const prevMid = prev.length === 2 && prev[0] && prev[1]
      ? { x: (prev[0].x + prev[1].x) / 2 - r.left, y: (prev[0].y + prev[1].y) / 2 - r.top }
      : mid;
    camera.set({
      ...zoomed,
      x: zoomed.x + (mid.x - prevMid.x) / zoomed.z,
      y: zoomed.y + (mid.y - prevMid.y) / zoomed.z,
    });
  };

  const onTouchUp = (e: PointerEvent) => {
    if (!touches.delete(e.pointerId)) return;
    if (touches.size < 2 && pinch) { pinch = null; onGestureEnd(); }
  };

  const onPointerUp = (e: PointerEvent) => { onTouchUp(e); endPan(); };

  // ── Space as a temporary hand tool ────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || e.repeat || locked()) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();                              // space would scroll otherwise
    spaceHeld = true;
    root.dataset['hand'] = '';
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    spaceHeld = false;
    delete root.dataset['hand'];
  };

  // Blur, not just keyup: alt-tabbing away with space held would otherwise
  // leave the hand tool stuck on until the next press.
  const onBlur = () => { spaceHeld = false; delete root.dataset['hand']; endPan(); };

  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointerdown', onTouchDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointermove', onTouchMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return () => {
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointerdown', onTouchDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointermove', onTouchMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    endPan();
  };
}

/**
 * The transform for a camera.
 *
 * `translate` is in pre-scale page units, which is why it is written after the
 * scale. When the zoom is exactly 1 the scale is dropped entirely: WebKit
 * treats any transform containing `scale()` as non-trivial and re-rasterises
 * the layer every frame, while a bare translate rides the cheap layer-move
 * path. Fill mode always runs at 1, so it always gets the fast path.
 */
export function transformFor(c: Camera): string {
  const x = toDomPrecision(c.x);
  const y = toDomPrecision(c.y);
  if (c.z === 1) return `translate(${x}px, ${y}px)`;
  return `scale(${toDomPrecision(c.z)}) translate(${x}px, ${y}px)`;
}

/** Where a frame's top-left sits on screen, for chrome that must not be scaled. */
export function chromePosition(page: { x: number; y: number }, c: Camera) {
  return { x: pageToScreen(page.x, c.x, c.z), y: pageToScreen(page.y, c.y, c.z) };
}

export { screenToPage };
