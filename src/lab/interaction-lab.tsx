import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  boundsOf, boxesIntersect, createCameraStore, lerpCamera, screenToPage, stepZoom,
  snapToDevicePixels, toDomPrecision, viewportCentre, visibleBounds, zoomAbout,
  zoomToBounds, type Box, type Camera,
} from './core/camera';
import { bindCanvasInput, transformFor } from './core/use-canvas-input';
import { clearLayout, createSaver, loadLayout, type StoredLayout } from './core/persistence';
import { affectedIds, applyCommand, createHistory, isNoop, type Command } from './core/history';
import { isLight, paintPixelGrid, parseColour } from './core/pixel-grid';
import {
  beginRulerPass, DARK_RULER, LIGHT_RULER, paintGuideLabels, paintGuides, paintRulers,
  type Band,
} from './core/canvas-rulers';
import {
  guideUnder, loadGuides, ruleAt, saveGuides, type Guide,
} from './core/rulers';
import { ScreenFrame } from './core/screen-frame';
import {
  resizeBox, snapMovingBox, snapResizedBox, SNAP_TOLERANCE_PX,
  type Handle, type SnapLine,
} from './core/snapping';
import { SCREENS } from './screens';
import styles from './core/lab.module.css';

/** How long the camera takes to travel, and the pause that counts as settled. */
const ANIM_MS = 320;
const IDLE_MS = 160;
/**
 * How long a run of arrow presses stays open as one undoable gesture. Holding
 * an arrow key fires thirty times and is one thing you did; thirty undo
 * entries turns Ctrl+Z into a key you hammer without being able to tell how
 * many times.
 */
const NUDGE_COMMIT_MS = 400;

/**
 * Three modes, and Escape walks back one at a time.
 *
 * `explore` is the canvas. `focus` is locked into one screen with the canvas
 * still around it. `fill` hands the screen the real window: the frame becomes
 * the viewport size and the screen reflows at true viewport width, which is
 * the only way to see how a screen behaves at a width its manifest never
 * declared.
 */
type Mode = 'explore' | 'focus' | 'fill';
type Layout = Record<string, { x: number; y: number; width: number; height: number }>;

/** Registry defaults with any saved overrides laid on top. */
function resolveLayout(stored: StoredLayout | null): Layout {
  const out: Layout = {};
  for (const def of SCREENS) {
    const saved = stored?.screens[def.id];
    out[def.id] = {
      x: saved?.x ?? def.defaultPosition.x,
      y: saved?.y ?? def.defaultPosition.y,
      width: saved?.width ?? def.width,
      height: saved?.height ?? def.height,
    };
  }
  return out;
}

const boxesOf = (layout: Layout): Box[] => Object.values(layout);

const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The canvas, and the root of the app.
 *
 * Read the camera work here as one rule: React never renders during a gesture.
 * Panning and zooming write `transform` on one element and a handful of CSS
 * variables, straight from the event, coalesced into a frame. Everything React
 * does know about, selection, mode, layout, changes only at the end of a
 * gesture or on a keystroke.
 */
export function InteractionLab() {
  const ids = useMemo(() => SCREENS.map((s) => s.id), []);

  /**
   * The first camera is computed synchronously, here, rather than after a
   * measuring pass. The root is fixed inset-0, so the window size *is* the
   * canvas size and there is nothing to wait for. Waiting would paint one
   * frame at a default camera first, and that flash is very visible.
   */
  let bootGuides: Guide[] = [];
  const boot = useRef<{ stored: StoredLayout | null; layout: Layout; camera: Camera } | null>(null);
  if (!boot.current) {
    const stored = loadLayout(ids);
    const layout = resolveLayout(stored);
    bootGuides = loadGuides();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const bounds = boundsOf(boxesOf(layout));
    boot.current = {
      stored,
      layout,
      camera: stored?.camera ?? (bounds ? zoomToBounds(bounds, viewport) : { x: 0, y: 0, z: 1 }),
    };
  }

  const store = useRef(createCameraStore(boot.current.camera)).current;
  const saver = useRef(createSaver()).current;
  const history = useRef(createHistory()).current;

  const [layout, setLayout] = useState<Layout>(boot.current.layout);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('explore');
  const [activeId, setActiveId] = useState<string | null>(null);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // DOM handles and caches. None of these belong in state: reading a rect in a
  // pointermove is the single easiest way to make a canvas stutter.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const rectRef = useRef<DOMRect>(new DOMRect(0, 0, 1, 1));
  const labelsRef = useRef(new Map<string, HTMLElement>());
  const escapeRef = useRef(new Map<string, () => boolean>());
  const exploreCameraRef = useRef<Camera | null>(null);
  /** The frame's real size, held while fill mode borrows the window's. */
  const focusCameraRef = useRef<Camera | null>(null);
  const animRef = useRef<number>(0);
  const frameRef = useRef<number>(0);
  const idleRef = useRef<number>(0);
  const gesturingRef = useRef(false);

  /**
   * Snap lines and the size badge are written straight to DOM rather than
   * rendered, for the same reason the camera is: they change on every
   * pointermove of a drag, and a React render per move is exactly the cost the
   * whole architecture exists to avoid.
   */
  /**
   * The pixel grid's canvas, sized in device pixels and repainted on every
   * camera write. It is the root's first child so it paints under the frames,
   * and it goes away entirely in fill mode, where the canvas is not the thing
   * you are looking at.
   */
  /**
   * Rulers and guides, on their own canvas above the frames.
   *
   * A canvas rather than DOM because a rule at 100% on a wide screen is a
   * couple of hundred ticks, and repositioning two hundred divs per camera
   * write is exactly the churn the rest of this design avoids.
   */
  const rulerRef = useRef<HTMLCanvasElement | null>(null);
  const [showRulers, setShowRulers] = useState(false);
  const showRulersRef = useRef(showRulers);
  showRulersRef.current = showRulers;
  const guidesRef = useRef<Guide[]>(bootGuides);
  const nextGuideId = useRef(bootGuides.length + 1);
  const activeGuideRef = useRef<number | null>(null);
  const [, bumpGuides] = useState(0);

  const gridRef = useRef<HTMLCanvasElement | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const showGridRef = useRef(showGrid);
  showGridRef.current = showGrid;

  const paintGrid = useCallback(() => {
    const canvas = gridRef.current;
    if (!canvas) return;
    const r = rectRef.current;
    const dpr = window.devicePixelRatio || 1;
    const want = { w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) };
    if (canvas.width !== want.w || canvas.height !== want.h) {
      canvas.width = want.w;
      canvas.height = want.h;
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!showGridRef.current || modeRef.current === 'fill') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    // The grid has to contrast with whatever colour the canvas has been set
    // to, so its own colour follows the background's luminance.
    const bg = parseColour(getComputedStyle(canvas).getPropertyValue('--canvas') || '#f1f1f1');
    paintPixelGrid(ctx, store.get(), { width: r.width, height: r.height },
      bg ? { light: isLight(bg) } : {});
  }, [store]);

  const paintGridRef = useRef<(() => void) | null>(null);
  paintGridRef.current = paintGrid;

  const paintRulerLayer = useCallback(() => {
    const canvas = rulerRef.current;
    if (!canvas) return;
    const r = rectRef.current;
    const dpr = window.devicePixelRatio || 1;
    const want = { w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) };
    if (canvas.width !== want.w || canvas.height !== want.h) {
      canvas.width = want.w;
      canvas.height = want.h;
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Hidden rather than unmounted in fill mode: the guides are still there,
    // there is just nothing on screen they relate to.
    if (!showRulersRef.current || modeRef.current === 'fill') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const bg = parseColour(getComputedStyle(canvas).getPropertyValue('--canvas') || '#f1f1f1');
    const colours = bg && !isLight(bg) ? DARK_RULER : LIGHT_RULER;
    const size = { width: r.width, height: r.height };
    const sel = selectedRef.current ? layoutRef.current[selectedRef.current] : null;
    const bands: Band[] = sel
      ? [{ x: [sel.x, sel.x + sel.width], y: [sel.y, sel.y + sel.height] }]
      : [];
    // Three passes, in this order: the guide lines pass under the gutters, the
    // gutters paint over them, and the guide labels sit on top of the gutters.
    beginRulerPass(ctx, size);
    paintGuides(ctx, store.get(), size, guidesRef.current, colours, activeGuideRef.current);
    paintRulers(ctx, store.get(), size, colours, bands);
    paintGuideLabels(ctx, store.get(), guidesRef.current, colours);
  }, [store]);

  const paintRulerRef = useRef<(() => void) | null>(null);
  paintRulerRef.current = paintRulerLayer;

  const snapLayerRef = useRef<HTMLDivElement | null>(null);
  const badgeRef = useRef<HTMLDivElement | null>(null);

  const drawSnapLines = useCallback((lines: readonly SnapLine[]) => {
    const host = snapLayerRef.current;
    if (!host) return;
    const c = store.get();
    const r = rectRef.current;
    host.replaceChildren(...lines.map((line) => {
      const el = document.createElement('div');
      el.className = styles.snapLine ?? '';
      el.dataset['axis'] = line.axis;
      const at = (line.at + (line.axis === 'x' ? c.x : c.y)) * c.z;
      const from = (line.from + (line.axis === 'x' ? c.y : c.x)) * c.z;
      const to = (line.to + (line.axis === 'x' ? c.y : c.x)) * c.z;
      if (line.axis === 'x') {
        el.style.left = `${at}px`;
        el.style.top = `${Math.min(from, to)}px`;
        el.style.height = `${Math.abs(to - from)}px`;
      } else {
        el.style.top = `${at}px`;
        el.style.left = `${Math.min(from, to)}px`;
        el.style.width = `${Math.abs(to - from)}px`;
      }
      void r;
      return el;
    }));
  }, [store]);

  const clearSnapLines = useCallback(() => {
    snapLayerRef.current?.replaceChildren();
    const badge = badgeRef.current;
    if (badge) badge.style.display = 'none';
  }, []);

  const showSizeBadge = useCallback((boxNow: Box) => {
    const badge = badgeRef.current;
    if (!badge) return;
    const c = store.get();
    badge.style.display = 'block';
    badge.style.left = `${(boxNow.x + boxNow.width / 2 + c.x) * c.z}px`;
    badge.style.top = `${(boxNow.y + boxNow.height + c.y) * c.z}px`;
    badge.textContent = `${Math.round(boxNow.width)} × ${Math.round(boxNow.height)}`;
  }, [store]);

  const [culled, setCulled] = useState<Record<string, boolean>>({});
  const culledRef = useRef(culled);
  culledRef.current = culled;

  const viewport = useCallback(
    () => ({ width: rectRef.current.width, height: rectRef.current.height }),
    [],
  );

  const readCanvas = useCallback(
    () => ({ rect: rectRef.current, z: store.get().z }),
    [store],
  );

  // ── Writing the camera to the DOM ─────────────────────────────────────────

  /**
   * One transform write per frame, plus the chrome that has to track it.
   *
   * Called from the store subscription, which fires per input event; the rAF
   * coalesces those into one write. Scheduling rAF *from a handler* lands in
   * the same frame's rendering update, so this costs no latency. Safari never
   * aligns wheel events to frames the way Chrome does, which is what makes the
   * coalescing worth having rather than merely tidy.
   */
  const applyCamera = useCallback((c: Camera, snap: boolean) => {
    const layer = layerRef.current;
    if (!layer) return;
    const dpr = window.devicePixelRatio || 1;
    const camera = snap
      ? { ...c, x: snapToDevicePixels(c.x, dpr * c.z), y: snapToDevicePixels(c.y, dpr * c.z) }
      : c;
    layer.style.transform = transformFor(camera);
    layer.style.setProperty('--inv-zoom', String(toDomPrecision(1 / camera.z)));
    paintGridRef.current?.();
    paintRulerRef.current?.();

    // Chrome is placed, not scaled: it lives outside the transformed layer, so
    // it never stretches mid-gesture the way anything inside the layer does.
    for (const [id, el] of labelsRef.current) {
      const box = layoutRef.current[id];
      if (!box) continue;
      const x = (box.x + camera.x) * camera.z;
      const y = (box.y + camera.y) * camera.z;
      el.style.transform = `translate(${toDomPrecision(x)}px, ${toDomPrecision(y)}px)`;
    }
  }, []);

  const schedule = useCallback((c: Camera) => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      applyCamera(store.get(), false);
    });
    void c;
  }, [applyCamera, store]);

  /** Which frames are worth rendering, recomputed per camera write, not per idle. */
  const recull = useCallback(() => {
    const r = rectRef.current;
    // The layer's ref runs before the root is measured, so at mount this rect
    // is still 1x1. Culling against it would hide every screen not touching
    // the camera's corner, which looks exactly like a broken restore.
    if (r.width <= 1 || r.height <= 1) return;
    const view = visibleBounds(store.get(), { width: r.width, height: r.height });
    let changed = false;
    const next: Record<string, boolean> = {};
    for (const [id, box] of Object.entries(layoutRef.current)) {
      const keep = id === selectedRef.current || id === activeId || boxesIntersect(view, box);
      next[id] = !keep;
      if (next[id] !== (culledRef.current[id] ?? false)) changed = true;
    }
    if (changed) setCulled(next);
  }, [activeId, store]);

  const persist = useCallback(() => {
    const screens: StoredLayout['screens'] = {};
    for (const [id, box] of Object.entries(layoutRef.current)) {
      screens[id] = { x: box.x, y: box.y, width: box.width, height: box.height };
    }
    saver.save({ camera: store.get(), screens });
  }, [saver, store]);

  /**
   * One self-rescheduling timer rather than a clearTimeout/setTimeout pair per
   * event. When the camera has been still long enough, commit the crisp
   * version: snap to device pixels, drop will-change so the layer re-rasters
   * sharp, and save.
   */
  const markMoved = useCallback(() => {
    if (idleRef.current) return;
    const tick = () => {
      idleRef.current = 0;
      if (gesturingRef.current) { idleRef.current = window.setTimeout(tick, IDLE_MS); return; }
      applyCamera(store.get(), true);
      // One frame later, so the snapped transform is committed before the
      // layer is de-promoted; Chrome re-rasters on the frame after removal.
      requestAnimationFrame(() => {
        if (!gesturingRef.current && layerRef.current) layerRef.current.style.willChange = '';
      });
      recull();
      persist();
    };
    idleRef.current = window.setTimeout(tick, IDLE_MS);
  }, [applyCamera, persist, recull, store]);

  // ── Camera animation ──────────────────────────────────────────────────────

  const animateTo = useCallback((target: Camera) => {
    cancelAnimationFrame(animRef.current);
    const from = store.get();
    const size = viewport();
    if (reduceMotion()) {
      store.set(target);
      return;
    }
    const started = performance.now();
    const step = () => {
      const t = (performance.now() - started) / ANIM_MS;
      store.set(t >= 1 ? target : lerpCamera(from, target, t, size));
      if (t < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
  }, [store, viewport]);

  const fitTo = useCallback((boxes: Box[]) => {
    const bounds = boundsOf(boxes);
    if (bounds) animateTo(zoomToBounds(bounds, viewport()));
  }, [animateTo, viewport]);

  const fitAll = useCallback(() => fitTo(boxesOf(layoutRef.current)), [fitTo]);

  // ── Modes ─────────────────────────────────────────────────────────────────

  const lockInto = useCallback((id: string) => {
    const box = layoutRef.current[id];
    if (!box) return;
    // Only snapshot when actually entering from explore, so cycling between
    // screens while locked in cannot corrupt the view Escape returns to.
    if (modeRef.current === 'explore') exploreCameraRef.current = store.get();
    setSelected(id);
    setActiveId(id);
    setMode('focus');
    animateTo(zoomToBounds(box, viewport(), 0));
  }, [animateTo, store, viewport]);

  const exitLock = useCallback(() => {
    // The shield comes back with the state change, before the camera has
    // finished travelling. Interaction is cut off at the moment you asked, not
    // when the animation happens to end.
    setMode('explore');
    setActiveId(null);
    focusCameraRef.current = null;
    const back = exploreCameraRef.current;
    exploreCameraRef.current = null;
    if (back) animateTo(back);
  }, [animateTo]);

  /**
   * Fill puts the frame at the viewport's origin at zoom 1.
   *
   * Not a separate container: moving the frame elsewhere in the DOM would
   * remount the screen and lose its state, which is the whole thing the canvas
   * is careful about. Same element, camera parked so the frame's page origin
   * lands at screen 0,0, and the frame sized to the window. Zoom 1 also means
   * the transform is a bare translate, which rides the cheap layer-move path
   * rather than re-rasterising every frame.
   */
  const enterFill = useCallback((id: string) => {
    const box = layoutRef.current[id];
    if (!box) return;
    if (modeRef.current === 'focus') focusCameraRef.current = store.get();
    else if (modeRef.current === 'explore') exploreCameraRef.current = store.get();
    setSelected(id);
    setActiveId(id);
    setMode('fill');
    store.set({ x: -box.x, y: -box.y, z: 1 });
  }, [store]);

  const exitFill = useCallback(() => {
    setMode('focus');
    const back = focusCameraRef.current;
    focusCameraRef.current = null;
    const box = activeId ? layoutRef.current[activeId] : null;
    if (back) animateTo(back);
    else if (box) animateTo(zoomToBounds(box, viewport(), 0));
  }, [activeId, animateTo, viewport]);

  /**
   * Guide gestures.
   *
   * A drag from a rule pulls out a new guide; the axis is implied by which
   * rule it started from, so there is nothing to choose. A drag on an existing
   * guide moves it, and dropping one back in a rule throws it away, which is
   * how every canvas tool does it and needs no explaining.
   */
  const commitGuides = useCallback(() => {
    saveGuides(guidesRef.current);
    bumpGuides((n) => n + 1);
    paintRulerRef.current?.();
  }, []);

  const onRulerPointerDown = useCallback((e: React.PointerEvent) => {
    if (modeRef.current !== 'explore' || !showRulersRef.current) return;
    const r = rectRef.current;
    const at = { x: e.clientX - r.left, y: e.clientY - r.top };
    const camera = store.get();

    const existing = guideUnder(guidesRef.current, at, camera);
    const fromRule = ruleAt(at.x, at.y);
    if (!existing && !fromRule) return;              // a press on the canvas

    e.preventDefault();
    e.stopPropagation();

    let guide: Guide;
    if (existing) {
      guide = existing;
    } else {
      guide = { id: nextGuideId.current, axis: fromRule as 'x' | 'y', at: 0 };
      nextGuideId.current += 1;
      guidesRef.current = [...guidesRef.current, guide];
    }
    activeGuideRef.current = guide.id;

    const place = (ev: PointerEvent) => {
      const c = store.get();
      const local = { x: ev.clientX - rectRef.current.left, y: ev.clientY - rectRef.current.top };
      const page = guide.axis === 'x'
        ? local.x / c.z - c.x
        : local.y / c.z - c.y;
      guide.at = Math.round(page);
      guidesRef.current = guidesRef.current.map((g) => (g.id === guide.id ? { ...guide } : g));
      paintRulerRef.current?.();
    };
    place(e.nativeEvent);

    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', place);
      window.removeEventListener('pointerup', up);
      const local = { x: ev.clientX - rectRef.current.left, y: ev.clientY - rectRef.current.top };
      // Dropped back in a rule, or off the canvas entirely: thrown away.
      if (ruleAt(local.x, local.y) !== null || local.x < 0 || local.y < 0) {
        guidesRef.current = guidesRef.current.filter((g) => g.id !== guide.id);
        activeGuideRef.current = null;
      }
      commitGuides();
    };

    window.addEventListener('pointermove', place);
    window.addEventListener('pointerup', up);
  }, [commitGuides, store]);

  const registerEscape = useCallback((id: string, fn: (() => boolean) | null) => {
    if (fn) escapeRef.current.set(id, fn);
    else escapeRef.current.delete(id);
  }, []);

  // ── Frame dragging ────────────────────────────────────────────────────────

  const dragRef = useRef<{ id: string; startX: number; startY: number; box: Box } | null>(null);

  /** Everything except the one being moved, which cannot snap to itself. */
  const othersOf = (id: string): Box[] =>
    Object.entries(layoutRef.current).filter(([k]) => k !== id).map(([, b]) => b);

  /** Write a frame's geometry straight to its element, mid-gesture. */
  const paintFrameRef = useRef<((id: string, boxNow: Box) => void) | null>(null);
  const paintFrame = useCallback((id: string, boxNow: Box) => {
    const el = document.querySelector<HTMLElement>(`[data-screen-id="${id}"].${styles.group}`);
    if (!el) return;
    el.style.transform = `translate(${boxNow.x}px, ${boxNow.y}px)`;
    el.style.width = `${boxNow.width}px`;
    el.style.height = `${boxNow.height}px`;
  }, []);
  paintFrameRef.current = paintFrame;

  /**
   * One place both gestures end, so nothing can commit half of it, and the one
   * place a history entry is written. One entry per completed gesture, with
   * the values captured at its start: coalescing by construction rather than
   * by merging sixty per-frame entries afterwards.
   */
  const commitGesture = useCallback((id: string, from: Box, to: Box) => {
    layoutRef.current = { ...layoutRef.current, [id]: to };
    setLayout({ ...layoutRef.current });
    clearSnapLines();
    commitNudgeRef.current?.();
    const command: Command = { kind: 'move', id, from: { ...from }, to: { ...to } };
    // A drag that ended where it started is not a thing you did.
    if (!isNoop(command)) history.push(command);
    persist();
    recull();
  }, [clearSnapLines, history, persist, recull]);

  /**
   * A run of arrow presses, still open.
   *
   * Held here rather than pushed per keypress, and flushed by anything that
   * pushes its own entry, so the command order stays truthful: undo right
   * after a nudge undoes the nudge.
   */
  const nudgeRef = useRef<{ id: string; from: Box; timer: number } | null>(null);

  const commitNudge = useCallback(() => {
    const pending = nudgeRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    nudgeRef.current = null;
    const to = layoutRef.current[pending.id];
    if (!to) return;
    const command: Command = { kind: 'move', id: pending.id, from: pending.from, to: { ...to } };
    if (!isNoop(command)) history.push(command);
  }, [history]);

  /** Put a layout on screen, from wherever it came from. */
  const applyLayout = useCallback((next: Record<string, Box>) => {
    layoutRef.current = next;
    setLayout({ ...next });
    for (const [id, boxNow] of Object.entries(next)) paintFrameRef.current?.(id, boxNow);
    applyCamera(store.get(), false);
    persist();
    recull();
  }, [applyCamera, persist, recull, store]);

  const commitNudgeRef = useRef<(() => void) | null>(null);
  commitNudgeRef.current = commitNudge;

  const stepHistory = useCallback((direction: 'undo' | 'redo') => {
    // Flush first, so undoing straight after a nudge undoes that nudge rather
    // than whatever happened before it.
    commitNudge();
    const command = direction === 'undo' ? history.undo() : history.redo();
    if (!command) return;
    applyLayout(applyCommand(layoutRef.current, command, direction));
    // Undo selects and reveals what it changed, which is what tldraw and
    // Excalidraw both do: an undo you cannot see is indistinguishable from one
    // that did not happen.
    const [first] = affectedIds(command);
    if (first) setSelected(first);
  }, [applyLayout, commitNudge, history]);

  const onDragStart = useCallback((id: string, e: React.PointerEvent) => {
    const box = layoutRef.current[id];
    if (!box || modeRef.current !== 'explore') return;
    e.stopPropagation();
    // Capture is an optimisation, not a requirement: the move and up listeners
    // are on the window, so the gesture works without it. It throws for a
    // pointer that is no longer down, and letting that abort the handler would
    // leave a gesture that never registered its listeners and never ends.
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* already up */ }
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, box: { ...box } };
    let latest = { ...box };

    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const z = store.get().z;
      const wanted = {
        ...d.box,
        x: d.box.x + (ev.clientX - d.startX) / z,
        y: d.box.y + (ev.clientY - d.startY) / z,
      };
      // Tolerance is in screen pixels, so it must be divided by zoom: eight
      // pixels of pointer slop is eight pixels whatever the canvas is doing.
      const snapped = snapMovingBox(
        wanted, othersOf(d.id),
        {
          // A guide you placed deliberately is at least as strong a target as
          // another frame's edge, which is what Figma and Penpot both do.
          x: guidesRef.current.filter((g) => g.axis === 'x').map((g) => g.at),
          y: guidesRef.current.filter((g) => g.axis === 'y').map((g) => g.at),
        },
        SNAP_TOLERANCE_PX / z,
        ev.ctrlKey || ev.metaKey,
      );
      latest = { ...wanted, x: snapped.x, y: snapped.y };
      layoutRef.current = { ...layoutRef.current, [d.id]: latest };
      paintFrame(d.id, latest);
      drawSnapLines(snapped.lines);
      applyCamera(store.get(), false);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = dragRef.current;
      dragRef.current = null;
      if (d) commitGesture(d.id, d.box, latest);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [applyCamera, commitGesture, drawSnapLines, paintFrame, store]);

  /**
   * Resizing is the same shape as dragging with one difference: only the
   * rounding half of snapping applies. Edge-to-edge smart snapping while
   * resizing fights the anchored edge, so it is deliberately not built rather
   * than half-built.
   */
  const onResizeStart = useCallback((id: string, handle: Handle, e: React.PointerEvent) => {
    const box = layoutRef.current[id];
    if (!box || modeRef.current !== 'explore') return;
    e.stopPropagation();
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* already up */ }
    const start = { ...box };
    const from = { x: e.clientX, y: e.clientY };
    let latest = { ...box };

    const move = (ev: PointerEvent) => {
      const z = store.get().z;
      latest = snapResizedBox(
        resizeBox(start, handle, (ev.clientX - from.x) / z, (ev.clientY - from.y) / z),
      );
      layoutRef.current = { ...layoutRef.current, [id]: latest };
      paintFrame(id, latest);
      showSizeBadge(latest);
      applyCamera(store.get(), false);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      commitGesture(id, start, latest);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [applyCamera, commitGesture, paintFrame, showSizeBadge, store]);

  // ── Element wiring, all through ref callbacks ─────────────────────────────

  const rootCallback = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el;
    if (!el) return undefined;

    const measure = () => {
      rectRef.current = el.getBoundingClientRect();
      recull();                      // now with a real rect, unlike at mount
      paintGrid();
      paintRulerLayer();
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);

    const unbind = bindCanvasInput(el, {
      camera: store,
      rect: () => rectRef.current,
      viewport,
      locked: () => modeRef.current !== 'explore',
      onGestureStart: () => {
        gesturingRef.current = true;
        el.dataset['gesturing'] = '';
        if (layerRef.current) layerRef.current.style.willChange = 'transform';
      },
      onGestureEnd: () => {
        gesturingRef.current = false;
        delete el.dataset['gesturing'];
        markMoved();
      },
    });

    const onPageHide = () => saver.saveNow();
    window.addEventListener('pagehide', onPageHide);

    return () => {
      ro.disconnect();
      unbind();
      window.removeEventListener('pagehide', onPageHide);
      saver.saveNow();
    };
  }, [markMoved, paintGrid, paintRulerLayer, recull, saver, store, viewport]);

  const layerCallback = useCallback((el: HTMLDivElement | null) => {
    layerRef.current = el;
    if (!el) return undefined;
    applyCamera(store.get(), true);
    return store.subscribe((c) => {
      // Zoom gestures promote the layer; a pan at rest does not need to.
      if (gesturingRef.current && el.style.willChange === '') el.style.willChange = 'transform';
      schedule(c);
      recull();
      markMoved();
    });
  }, [applyCamera, markMoved, recull, schedule, store]);

  const labelCallback = useCallback((id: string) => (el: HTMLElement | null) => {
    if (!el) { labelsRef.current.delete(id); return; }
    labelsRef.current.set(id, el);
    // Place it now. Chrome is positioned by the camera write, and refs attach
    // after the first one has already run, so a label registering later would
    // sit at its parked offscreen position until the camera next moved.
    applyCamera(store.get(), false);
  }, [applyCamera, store]);

  // ── Keyboard ──────────────────────────────────────────────────────────────

  const keysCallback = useCallback((el: HTMLDivElement | null) => {
    if (!el) return undefined;

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      // Locked in, the screen owns the keyboard. The lab listens for two keys
      // and nothing else, and Escape goes to the screen first.
      if (modeRef.current !== 'explore') {
        if (e.key === 'Escape') {
          const claim = activeId ? escapeRef.current.get(activeId) : undefined;
          if (claim && claim()) return;       // the screen had something to close
          e.preventDefault();
          // One step back, not all the way out: fill returns to focus, focus
          // returns to the canvas.
          if (modeRef.current === 'fill') exitFill();
          else exitLock();
        } else if (e.shiftKey && e.code === 'Digit1') {
          e.preventDefault();
          exitLock();
          fitAll();
        } else if (e.shiftKey && e.code === 'KeyF') {
          e.preventDefault();
          if (modeRef.current === 'fill') exitFill();
          else if (activeId) enterFill(activeId);
        } else if (e.key === 'Tab') {
          // Cycle which screen is in front without leaving the mode.
          e.preventDefault();
          const order = SCREENS.map((sc) => sc.id);
          const at = activeId ? order.indexOf(activeId) : -1;
          const next = order[(at + (e.shiftKey ? -1 : 1) + order.length) % order.length];
          if (!next) return;
          if (modeRef.current === 'fill') enterFill(next);
          else lockInto(next);
        }
        return;
      }

      const centre = () => {
        const r = rectRef.current;
        return { x: r.width / 2, y: r.height / 2 };
      };

      if (e.shiftKey && e.code === 'KeyR') {
        e.preventDefault();
        setShowRulers((v) => { showRulersRef.current = !v; return !v; });
        requestAnimationFrame(() => paintRulerRef.current?.());
        return;
      }
      // The ruler gets first refusal on Delete and the arrows while a guide is
      // selected, the way Figma layers guide keys over object keys. Without
      // this the lab would delete the selected SCREEN when you meant the guide.
      if (showRulersRef.current && activeGuideRef.current !== null) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          guidesRef.current = guidesRef.current.filter((g) => g.id !== activeGuideRef.current);
          activeGuideRef.current = null;
          commitGuides();
          return;
        }
        if (e.key.startsWith('Arrow')) {
          const guide = guidesRef.current.find((g) => g.id === activeGuideRef.current);
          const wants = e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? 'x' : 'y';
          if (guide && guide.axis === wants) {
            e.preventDefault();
            const step = e.shiftKey ? 10 : 1;
            const delta = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -step : step;
            guidesRef.current = guidesRef.current.map((g) =>
              (g.id === guide.id ? { ...g, at: g.at + delta } : g));
            commitGuides();
            return;
          }
        }
        if (e.key === 'Escape') {
          activeGuideRef.current = null;
          paintRulerRef.current?.();
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        stepHistory(e.shiftKey ? 'redo' : 'undo');
      } else if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); fitAll(); }
      else if (e.shiftKey && e.code === 'Digit2') {
        e.preventDefault();
        const box = selectedRef.current ? layoutRef.current[selectedRef.current] : null;
        if (box) fitTo([box]);
      } else if (e.shiftKey && e.code === 'Digit0') {
        e.preventDefault();
        const p = centre();
        animateTo(zoomAbout(store.get(), p.x, p.y, 1));
      } else if (e.shiftKey && e.code === 'KeyF') {
        e.preventDefault();
        const target = selectedRef.current ?? SCREENS[0]?.id;
        if (target) enterFill(target);
      } else if (e.key === 'Enter' && selectedRef.current) {
        e.preventDefault();
        lockInto(selectedRef.current);
      } else if (e.key === 'Escape') {
        setSelected(null);
      } else if (e.key === '=' || e.key === '+' || e.key === '-') {
        e.preventDefault();
        const p = centre();
        const dir = e.key === '-' ? -1 : 1;
        animateTo(zoomAbout(store.get(), p.x, p.y, stepZoom(store.get().z, dir)));
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const order = SCREENS.map((s) => s.id);
        const at = selectedRef.current ? order.indexOf(selectedRef.current) : -1;
        const next = order[(at + (e.shiftKey ? -1 : 1) + order.length) % order.length];
        if (next) setSelected(next);
      } else if (e.key.startsWith('Arrow') && selectedRef.current) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;             // Figma's amounts
        const id = selectedRef.current;
        const box = layoutRef.current[id];
        if (!box) return;
        const dx = (e.key === 'ArrowRight' ? step : 0) - (e.key === 'ArrowLeft' ? step : 0);
        const dy = (e.key === 'ArrowDown' ? step : 0) - (e.key === 'ArrowUp' ? step : 0);
        // Nudges do not snap: Figma moves by the exact amount you asked for.
        const to = { ...box, x: box.x + dx, y: box.y + dy };
        if (!nudgeRef.current || nudgeRef.current.id !== id) {
          commitNudge();
          nudgeRef.current = { id, from: { ...box }, timer: 0 };
        }
        const run = nudgeRef.current;
        clearTimeout(run.timer);
        run.timer = window.setTimeout(() => commitNudge(), NUDGE_COMMIT_MS);
        layoutRef.current = { ...layoutRef.current, [id]: to };
        setLayout({ ...layoutRef.current });
        paintFrame(id, to);
        applyCamera(store.get(), false);
        persist();
      }
    };

    // Capture, so a focused screen cannot swallow Escape before the lab sees it.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activeId, animateTo, applyCamera, commitGuides, commitNudge, enterFill, exitFill,
      exitLock, fitAll, fitTo, lockInto, paintFrame, persist, stepHistory, store]);

  // Layout changes from the keyboard still have to reach the DOM and storage.
  layoutRef.current = layout;

  const zoomLabel = useSyncExternalStore(
    useCallback((fn: () => void) => store.subscribe(fn), [store]),
    () => Math.round(store.get().z * 100),
  );

  const activeName = SCREENS.find((s) => s.id === activeId)?.name ?? '';

  return (
    <div className={styles.root} ref={rootCallback} data-mode={mode}>
      <canvas className={styles.grid} ref={gridRef} aria-hidden="true" />
      <div ref={keysCallback} hidden />

      <div
        className={styles.layer}
        ref={layerCallback}
        data-canvas-background=""
        onPointerDown={() => { if (mode === 'focus') exitLock(); }}
      >
        {SCREENS.map((def) => {
          const box = layout[def.id];
          if (!box) return null;
          // Fill borrows the window's size for the duration. The stored layout
          // is untouched, so leaving fill restores the real size with nothing
          // to undo.
          const filling = mode === 'fill' && activeId === def.id;
          const size = filling
            ? { width: window.innerWidth, height: window.innerHeight }
            : { width: box.width, height: box.height };
          return (
            <ScreenFrame
              key={def.id}
              def={def}
              position={{ x: box.x, y: box.y }}
              size={size}
              selected={selected === def.id}
              active={activeId === def.id}
              dimmed={mode === 'focus' && activeId !== def.id}
              visible={!culled[def.id]}
              zoom={zoomLabel / 100}
              readCanvas={readCanvas}
              onSelect={setSelected}
              onLockIn={lockInto}
              onDragStart={onDragStart}
              onResizeStart={onResizeStart}
              registerEscape={registerEscape}
            />
          );
        })}
      </div>

      <canvas
        className={styles.rulers}
        ref={rulerRef}
        aria-hidden="true"
        data-on={showRulers && mode !== 'fill' || undefined}
        onPointerDown={onRulerPointerDown}
      />

      <div className={styles.chrome} ref={chromeRef}>
        <div ref={snapLayerRef} />
        <div className={styles.sizeBadge} ref={badgeRef} style={{ display: 'none' }} />

        {SCREENS.map((def) => (
          <div
            key={def.id}
            className={styles.label}
            ref={labelCallback(def.id)}
            data-screen-id={def.id}
            data-selected={selected === def.id || undefined}
            style={{ transform: 'translate(-9999px, -9999px)' }}
            onPointerDown={(e) => { e.stopPropagation(); setSelected(def.id); }}
            onDoubleClick={() => lockInto(def.id)}
          >
            {def.name}
          </div>
        ))}

        <div className={styles.hud}>
          <button
            type="button"
            className={styles.hudButton}
            onClick={fitAll}
            title="Zoom to fit everything"
          >
            {zoomLabel}%
          </button>
          {mode !== 'explore' && (
            <>
              <span className={styles.hudDivider} />
              <span className={styles.hudBadge}>
                <b>{activeName}</b>
                {mode === 'fill' ? ' · filling · Esc for the frame' : ' · Esc to exit'}
              </span>
              <button
                type="button"
                className={styles.hudButton}
                onClick={() => (mode === 'fill' ? exitFill() : activeId && enterFill(activeId))}
                title="Give this screen the whole window (Shift F)"
              >
                {mode === 'fill' ? 'Frame' : 'Fill'}
              </button>
            </>
          )}
          <span className={styles.hudDivider} />
          <button
            type="button"
            className={styles.hudButton}
            data-on={showGrid || undefined}
            onClick={() => { setShowGrid((v) => !v); requestAnimationFrame(() => paintGrid()); }}
            title="The pixel grid, ten units"
          >
            Grid
          </button>
          <button
            type="button"
            className={styles.hudButton}
            data-on={showRulers || undefined}
            onClick={() => {
              setShowRulers((v) => { showRulersRef.current = !v; return !v; });
              requestAnimationFrame(() => paintRulerRef.current?.());
            }}
            title="Rulers and guides (Shift R). Drag out of a rule to place one"
          >
            Rulers
          </button>
          <button
            type="button"
            className={styles.hudButton}
            onClick={() => {
              const before = { ...layoutRef.current };
              clearLayout();
              const fresh = resolveLayout(null);
              commitNudge();
              const command: Command = { kind: 'layout', from: before, to: fresh };
              if (!isNoop(command)) history.push(command);
              applyLayout(fresh);
              fitTo(boxesOf(fresh));
            }}
            title="Put every screen back where the registry says"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

export { screenToPage, viewportCentre };
