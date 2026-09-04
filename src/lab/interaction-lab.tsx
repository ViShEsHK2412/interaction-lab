import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  boundsOf, boxesIntersect, createCameraStore, lerpCamera, screenToPage, stepZoom,
  snapToDevicePixels, toDomPrecision, viewportCentre, visibleBounds, zoomAbout,
  zoomToBounds, type Box, type Camera,
} from './core/camera';
import { bindCanvasInput, transformFor } from './core/use-canvas-input';
import { clearLayout, createSaver, loadLayout, type StoredLayout } from './core/persistence';
import { affectedIds, applyCommand, createHistory, isNoop, type Command } from './core/history';
import { isLight, paintPixelGrid, parseColour, pickReadable } from './core/pixel-grid';
import {
  beginRulerPass, DARK_RULER, LIGHT_RULER, paintGuideLabels, paintGuides, paintRulers,
  type Band,
} from './core/canvas-rulers';
import {
  guideUnder, loadGuides, ruleAt, saveGuides, type Guide,
} from './core/rulers';
import { paintMeasurements } from './core/measurements';
import { copyName, labFs } from './core/lab-fs';
import { drainPendingToast, toast, toastAfterReload, Toasts } from './core/lab-toasts';
import {
  addSwatch, loadColour, loadSwatches, normaliseHex, saveColour, saveSwatches,
} from './core/canvas-colour';
import { ScreenFrame } from './core/screen-frame';
import {
  distributeRow, resizeBox, snapMovingBox, snapResizedBox, SNAP_TOLERANCE_PX,
  type Handle, type SnapLine,
} from './core/snapping';
import { SCREENS } from './screens';
import { Icon } from './core/icons';
import './core/theme.css';
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
/*
 * Snapping and nudging, tunable in one place, which is where the spec asks for
 * them. `SHOW_PIXEL_GRID` is deliberately not here: the grid has a HUD toggle,
 * and a build-time flag for something with a button would be a second answer to
 * a settled question.
 */

/** Off makes every drag free. Geometry snapping and pixel rounding both go. */
const SNAP_TO_GRID = true;

/** Figma's nudge amounts. Shift takes the big one. */
const NUDGE_SMALL = 1;
const NUDGE_BIG = 10;

/**
 * How long a run of arrow presses stays one undo entry. Long enough that
 * holding a key is a single step, short enough that a deliberate second nudge
 * is its own.
 */
const NUDGE_COMMIT_MS = 400;
/** Space left between frames when they are tidied into a row. */
const CLEANUP_GAP = 200;

/**
 * How far below the top of the viewport the focused frame's edge has to be
 * before the fill toggle can hang above it. 30px of button and margin, plus the
 * 4px the selection ring reaches.
 */
const PLAY_REACH = 34;

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
  const activeIdRef = useRef<string | null>(null);

  /**
   * Setters that update their ref in the same breath.
   *
   * The refs exist so event handlers can read current values without being
   * rebuilt, and assigning them during render leaves a window where the state
   * has changed and the ref has not. Two Escapes in one tick both read the old
   * mode, and the second does nothing: pressing Escape twice quickly in fill
   * mode landed in focus rather than explore. Key repeat has the same shape.
   */
  const goMode = useCallback((next: Mode) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  const select = useCallback((next: string | null) => {
    selectedRef.current = next;
    setSelected(next);
  }, []);

  const goActive = useCallback((next: string | null) => {
    activeIdRef.current = next;
    setActiveId(next);
  }, []);
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

  /**
   * Alt-hover measurement, entirely on refs.
   *
   * Zero React renders while measuring: one window pointermove resolves the
   * hovered frame, and the canvas repaints from the camera subscription. A
   * measurement that re-rendered on every pointer move would be the one piece
   * of chrome undoing what the rest of the design is careful about.
   */
  const measureRef = useRef<HTMLCanvasElement | null>(null);
  const altRef = useRef(false);
  const hoveredRef = useRef<string | null>(null);

  const paintMeasureLayer = useCallback(() => {
    const canvas = measureRef.current;
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
    const sel = selectedRef.current ? layoutRef.current[selectedRef.current] : null;
    const hov = hoveredRef.current ? layoutRef.current[hoveredRef.current] : null;
    // The fast path: with Alt up there is nothing to draw, and this runs on
    // every camera write.
    if (!altRef.current || !sel || !hov || hoveredRef.current === selectedRef.current
        || modeRef.current !== 'explore') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    paintMeasurements(ctx, store.get(), { width: r.width, height: r.height }, sel, hov);
  }, [store]);

  const paintMeasureRef = useRef<(() => void) | null>(null);
  paintMeasureRef.current = paintMeasureLayer;

  const gridRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasColour, setCanvasColour] = useState<string>(loadColour);
  const [swatches, setSwatches] = useState<string[]>(loadSwatches);
  const [colourOpen, setColourOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(canvasColour);

  /** Applied live; only Save puts it in the row. */
  const applyColour = useCallback((next: string) => {
    const hex = normaliseHex(next);
    if (!hex) return;
    setCanvasColour(hex);
    setHexDraft(hex);
    saveColour(hex);
    // Both the grid and the rulers pick their own colour from the background,
    // so recolouring the canvas has to repaint them.
    requestAnimationFrame(() => {
      paintGridRef.current?.();
      paintRulerRef.current?.();
    });
  }, []);

  /**
   * The window's size, tracked only while a screen is filling.
   *
   * Fill is the one mode where a resize means anything: explore and focus
   * frames have fixed page-space sizes, so opening devtools cannot reflow
   * them. Without this the filled screen kept whatever size the window had
   * when fill started, which is precisely the case fill exists to test.
   */
  const [windowSize, setWindowSize] = useState(
    () => ({ width: window.innerWidth, height: window.innerHeight }),
  );
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

  const colourOpenRef = useRef(false);

  /**
   * The last known pointer position, in canvas coordinates.
   *
   * Starts at the viewport centre so a shortcut pressed before the pointer has
   * ever moved still anchors somewhere sensible rather than at 0, 0.
   */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

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

  /**
   * The duplicate ghost. Alt-dragging leaves the original where it is and
   * tracks a dashed outline under the pointer; dropping it copies the folder
   * and places the copy exactly there.
   *
   * In the layer rather than in screen-space chrome, because it stands for a
   * frame: it has to scale with the canvas the way the frame it will become
   * does, or the preview lies about the size of the thing you are placing.
   */
  const ghostRef = useRef<HTMLDivElement | null>(null);

  const showGhost = useCallback((box: Box | null) => {
    const el = ghostRef.current;
    if (!el) return;
    if (!box) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.transform = `translate(${box.x}px, ${box.y}px)`;
    el.style.width = `${box.width}px`;
    el.style.height = `${box.height}px`;
  }, []);

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
    paintMeasureRef.current?.();

    // Chrome is placed, not scaled: it lives outside the transformed layer, so
    // it never stretches mid-gesture the way anything inside the layer does.
    for (const [id, el] of labelsRef.current) {
      const box = layoutRef.current[id];
      if (!box) continue;
      const x = (box.x + camera.x) * camera.z;
      const y = (box.y + camera.y) * camera.z;
      el.style.transform = `translate(${toDomPrecision(x)}px, ${toDomPrecision(y)}px)`;
    }

    // Right-aligned to the frame, which means its position depends on the
    // frame's width *on screen*, not in page units.
    const play = playRef.current;
    const focused = activeIdRef.current ? layoutRef.current[activeIdRef.current] : null;
    if (play && focused) {
      const x = (focused.x + focused.width + camera.x) * camera.z;
      const y = (focused.y + camera.y) * camera.z;
      /*
       * Above the corner when there is room, inside it when there is not.
       *
       * The button hangs 30px above the frame's top edge, and focus mode fits
       * the frame to the viewport, so in the ordinary case it sat at y = -30
       * and could not be clicked at all. Only the shortcut worked, and only if
       * you knew it. Below the threshold it tucks inside the frame instead,
       * which is where Figma keeps this kind of chrome anyway.
       */
      if (y >= PLAY_REACH) delete play.dataset['inside'];
      else play.dataset['inside'] = '';
      play.style.transform = `translate(${toDomPrecision(x)}px, ${toDomPrecision(Math.max(y, PLAY_REACH))}px)`;
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
    select(id);
    goActive(id);
    goMode('focus');
    animateTo(zoomToBounds(box, viewport(), 0));
  }, [animateTo, store, viewport]);

  const exitLock = useCallback(() => {
    // The shield comes back with the state change, before the camera has
    // finished travelling. Interaction is cut off at the moment you asked, not
    // when the animation happens to end.
    goMode('explore');
    goActive(null);
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
    select(id);
    goActive(id);
    goMode('fill');
    setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    store.set({ x: -box.x, y: -box.y, z: 1 });
  }, [store]);

  const exitFill = useCallback(() => {
    goMode('focus');
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

  /** Registry positions, as one undoable command. Shared by the HUD and the key. */
  const resetLayout = useCallback(() => {
    commitNudge();
    const before = { ...layoutRef.current };
    clearLayout();
    const fresh = resolveLayout(null);
    const command: Command = { kind: 'layout', from: before, to: fresh };
    if (!isNoop(command)) history.push(command);
    applyLayout(fresh);
    fitTo(boxesOf(fresh));
    toast('Layout reset');
  }, [applyLayout, commitNudge, fitTo, history]);

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
    if (first) select(first);
  }, [applyLayout, commitNudge, history]);

  const onDragStart = useCallback((id: string, e: React.PointerEvent) => {
    const box = layoutRef.current[id];
    if (!box || modeRef.current !== 'explore') return;
    e.stopPropagation();
    // Alt held at the start means duplicate, and it is decided once: picking
    // it up mid-drag would change what the gesture means halfway through.
    const duplicating = e.altKey;
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
        SNAP_TO_GRID ? SNAP_TOLERANCE_PX / z : 0,
        ev.ctrlKey || ev.metaKey,
      );
      latest = { ...wanted, x: snapped.x, y: snapped.y };
      if (duplicating) {
        // The original does not move. Only the ghost follows.
        showGhost(latest);
      } else {
        layoutRef.current = { ...layoutRef.current, [d.id]: latest };
        paintFrame(d.id, latest);
      }
      drawSnapLines(snapped.lines);
      applyCamera(store.get(), false);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (!duplicating) { commitGesture(d.id, d.box, latest); return; }

      showGhost(null);
      clearSnapLines();
      const def = SCREENS.find((sc) => sc.id === d.id);
      if (!def) return;
      const as = copyName(def.dir, SCREENS.map((sc) => sc.dir));
      saver.saveNow();
      void labFs.duplicate(def.dir, as, `${def.name} copy`, { x: latest.x, y: latest.y })
        .then((ok) => {
          if (!ok) { toast('Could not duplicate: no dev server', 'warn'); return; }
          toastAfterReload(`Duplicated as ${as}`);
          location.reload();
        });
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [applyCamera, clearSnapLines, commitGesture, drawSnapLines, paintFrame, saver, showGhost, store]);

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
      // Only in fill: everywhere else a render here would be for nothing.
      if (modeRef.current === 'fill') {
        setWindowSize({ width: window.innerWidth, height: window.innerHeight });
      }
      recull();                      // now with a real rect, unlike at mount
      paintGrid();
      paintRulerLayer();
      paintMeasureLayer();
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);

    const unbind = bindCanvasInput(el, {
      camera: store,
      rect: () => rectRef.current,
      viewport,
      locked: () => modeRef.current !== 'explore',
      // Any input cancels a camera animation, so a wheel mid-flight takes
      // over instead of being overwritten by the next animation frame.
      onInput: () => cancelAnimationFrame(animRef.current),
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

    drainPendingToast();
    // Once, ever. A hint that comes back every session is not a hint.
    try {
      if (!localStorage.getItem('interaction-lab:seen:v1')) {
        localStorage.setItem('interaction-lab:seen:v1', '1');
        toast('Double-click a screen to use it');
      }
    } catch { /* storage disabled; a hint is not worth an exception */ }
    const onPageHide = () => saver.saveNow();
    window.addEventListener('pagehide', onPageHide);

    /**
     * Alt-hover measurement. One capture-phase pointermove for the whole
     * canvas, resolving the frame under the pointer by closest(), and nothing
     * renders.
     */
    const onHover = (ev: PointerEvent) => {
      // Where the pointer is, in canvas coordinates. Shift 0 zooms to 100%
      // *at the cursor*, which needs a position the keyboard event cannot
      // carry. Piggybacked on the listener that already runs rather than
      // adding a second one at pointer frequency.
      const r = rectRef.current;
      pointerRef.current = { x: ev.clientX - r.left, y: ev.clientY - r.top };

      // Buttons down means a drag is in progress. Measurements must not fight
      // a gesture, and Alt is shared with the duplicate-drag.
      if (ev.buttons !== 0) {
        if (hoveredRef.current !== null) { hoveredRef.current = null; paintMeasureRef.current?.(); }
        return;
      }
      const target = (ev.target as HTMLElement | null)?.closest?.('[data-screen-id]');
      const id = target instanceof HTMLElement ? target.dataset['screenId'] ?? null : null;
      if (id === hoveredRef.current) return;
      hoveredRef.current = id;
      if (altRef.current) paintMeasureRef.current?.();
    };

    const onAlt = (ev: KeyboardEvent) => {
      const down = ev.type === 'keydown' && ev.altKey;
      if (down === altRef.current) return;
      altRef.current = down;
      paintMeasureRef.current?.();
    };

    // Blur too: alt-tabbing away with Alt held would otherwise leave the
    // measurement stuck on screen with nothing driving it.
    const onBlur = () => { altRef.current = false; paintMeasureRef.current?.(); };

    window.addEventListener('pointermove', onHover, true);
    window.addEventListener('keydown', onAlt);
    window.addEventListener('keyup', onAlt);
    window.addEventListener('blur', onBlur);

    return () => {
      ro.disconnect();
      unbind();
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pointermove', onHover, true);
      window.removeEventListener('keydown', onAlt);
      window.removeEventListener('keyup', onAlt);
      window.removeEventListener('blur', onBlur);
      saver.saveNow();
    };
  }, [markMoved, paintGrid, paintMeasureLayer, paintRulerLayer, recull, saver, store, viewport]);

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

  /**
   * The play button, pinned above the focused frame's top-right corner.
   *
   * Screen-space chrome like the labels, and placed by the same camera write,
   * because anything inside the transformed layer is part of its raster and
   * visibly stretches mid-zoom. It is sized to the frame's width on screen so
   * it right-aligns however far the canvas is zoomed.
   */
  const playRef = useRef<HTMLButtonElement | null>(null);

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
      // composedPath()[0] rather than target: an event from inside an open
      // shadow root is retargeted to the host, so a plain target check cannot
      // see an input a screen rendered in a shadow tree, and the lab would
      // steal the keystroke.
      const t = (e.composedPath?.()[0] ?? e.target) as HTMLElement | null;
      if (t && typeof t === 'object' && 'tagName' in t
          && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
              || t.isContentEditable)) return;

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

      /*
       * The ruler gets first refusal on Delete, Escape and the arrows while a
       * guide is selected, the way Figma layers guide keys over object keys.
       *
       * This has to sit ahead of the file operations, and it did not: the
       * block was written with exactly this comment and then placed *below*
       * the delete handler, so pressing Delete with a guide selected matched
       * the screen branch first and moved a whole screen folder to the trash.
       * First refusal is an ordering claim, and ordering is the only thing
       * that can honour it.
       */
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
      // Duplicate, delete and undo-delete are file operations, so they end in
      // a reload: the registry is discovered from the folders on disk, and the
      // only honest way to show the new one is to read them again. Everything
      // is persisted before the request, so the reload can land whenever.
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyD' && selectedRef.current) {
        e.preventDefault();
        const def = SCREENS.find((sc) => sc.id === selectedRef.current);
        const box = selectedRef.current ? layoutRef.current[selectedRef.current] : null;
        if (!def || !box) return;
        const as = copyName(def.dir, SCREENS.map((sc) => sc.dir));
        saver.saveNow();
        void labFs.duplicate(def.dir, as, `${def.name} copy`, { x: box.x + 32, y: box.y + 32 })
          .then((ok) => {
            if (!ok) { toast('Could not duplicate: no dev server', 'warn'); return; }
            toastAfterReload(`Duplicated as ${as}`);
            location.reload();
          });
        return;
      }
      // Ahead of delete, and delete refuses the modifiers below, because the
      // two shortcuts share a key: Ctrl+Shift+Backspace matched delete first
      // and removed a screen when it was asked to reset the layout.
      if (e.key === 'Escape' && colourOpenRef.current) {
        e.preventDefault();
        setColourOpen(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Backspace') {
        e.preventDefault();
        resetLayout();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace')
          && !e.ctrlKey && !e.metaKey && !e.shiftKey && selectedRef.current) {
        e.preventDefault();
        const def = SCREENS.find((sc) => sc.id === selectedRef.current);
        if (!def) return;
        saver.saveNow();
        void labFs.remove(def.dir).then((token) => {
          if (!token) { toast('Could not delete: no dev server', 'warn'); return; }
          // The token is what undo needs, and it has to survive the reload the
          // delete triggers, so it goes to sessionStorage before the reload.
          try {
            sessionStorage.setItem('interaction-lab:trash:v1',
              JSON.stringify({ dir: def.dir, token }));
          } catch { /* disabled */ }
          toastAfterReload(`Deleted ${def.name}. Ctrl+Z to put it back`);
          location.reload();
        });
        return;
      }
      // Ctrl+C, not Cmd+C: copying is Cmd, and a canvas has nothing to copy.
      if (e.ctrlKey && !e.metaKey && e.code === 'KeyC') {
        e.preventDefault();
        commitNudge();
        const before = { ...layoutRef.current };
        const placed = distributeRow(
          Object.entries(before).map(([id, b]) => ({ ...b, id })),
          CLEANUP_GAP,
        );
        const after: Record<string, Box> = { ...before };
        for (const [id, at] of Object.entries(placed)) {
          const box = before[id];
          if (box) after[id] = { ...box, ...at };
        }
        const command: Command = { kind: 'layout', from: before, to: after };
        if (!isNoop(command)) history.push(command);
        applyLayout(after);
        fitTo(boxesOf(after));
        // Write the row back to the manifests, so the files agree with the
        // canvas rather than drifting from it. Best effort: no dev server, no
        // write, and the live layout still overrides the defaults anyway.
        saver.saveNow();
        const byDir: Record<string, { x: number; y: number }> = {};
        for (const def of SCREENS) {
          const at = after[def.id];
          if (at) byDir[def.dir] = { x: at.x, y: at.y };
        }
        void labFs.setPositions(byDir);
        toast('Tidied into a row');
        return;
      }
      if (e.shiftKey && e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowRulers((v) => { showRulersRef.current = !v; return !v; });
        requestAnimationFrame(() => paintRulerRef.current?.());
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        let trashed: { dir: string; token: string } | null = null;
        try {
          const raw = sessionStorage.getItem('interaction-lab:trash:v1');
          trashed = raw ? JSON.parse(raw) : null;
        } catch { /* disabled */ }
        // A deleted screen is the biggest thing undo can give back, so it
        // takes precedence over the layout stack.
        if (trashed && !e.shiftKey) {
          try { sessionStorage.removeItem('interaction-lab:trash:v1'); } catch { /* disabled */ }
          saver.saveNow();
          void labFs.restore(trashed.dir, trashed.token).then((ok) => {
            // The VS Code rule: a failed inverse means the target changed on
            // disk outside the lab. Drop the entry and say so, rather than
            // leaving a Ctrl+Z that does nothing forever.
            if (!ok) { toast('Skipped: that screen changed on disk', 'warn'); return; }
            toastAfterReload('Restored');
            location.reload();
          });
          return;
        }
        stepHistory(e.shiftKey ? 'redo' : 'undo');
      } else if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); fitAll(); }
      else if (e.shiftKey && e.code === 'Digit2') {
        e.preventDefault();
        const box = selectedRef.current ? layoutRef.current[selectedRef.current] : null;
        if (box) fitTo([box]);
      } else if (e.shiftKey && e.code === 'Digit0') {
        e.preventDefault();
        // At the cursor, unlike the +/- steps, which are centred. The
        // difference is deliberate in the spec: 100% is a thing you want
        // *here*, next to whatever you were looking at.
        const p = pointerRef.current ?? centre();
        animateTo(zoomAbout(store.get(), p.x, p.y, 1));
      } else if (e.shiftKey && e.code === 'KeyF') {
        e.preventDefault();
        const target = selectedRef.current ?? SCREENS[0]?.id;
        if (target) enterFill(target);
      } else if (e.key === 'Enter' && selectedRef.current) {
        e.preventDefault();
        lockInto(selectedRef.current);
      } else if (e.key === 'Escape') {
        select(null);
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
        if (next) select(next);
      } else if (e.key.startsWith('Arrow') && selectedRef.current) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_BIG : NUDGE_SMALL;
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
  }, [activeId, animateTo, applyCamera, applyLayout, commitGuides, commitNudge, enterFill,
      exitFill, exitLock, fitAll, fitTo, history, lockInto, paintFrame, persist,
      resetLayout, saver, stepHistory, store]);

  // Layout changes from the keyboard still have to reach the DOM and storage.
  layoutRef.current = layout;

  const zoomLabel = useSyncExternalStore(
    useCallback((fn: () => void) => store.subscribe(fn), [store]),
    () => Math.round(store.get().z * 100),
  );

  colourOpenRef.current = colourOpen;
  const activeName = SCREENS.find((s) => s.id === activeId)?.name ?? '';
  const parsedCanvas = parseColour(canvasColour);
  const canvasTheme = parsedCanvas && !isLight(parsedCanvas) ? 'dark' : 'light';
  /*
   * Measured against the canvas rather than flipped by its luminance. A binary
   * flip cannot solve a mid grey, which is hostile to both a dark grey and a
   * light one: at #808080 the label sat at 1.75:1 either way. Preference order
   * keeps the muted grey wherever it clears 4.5:1 and only reaches for an
   * extreme where nothing else will do.
   */
  const labelColour = pickReadable(canvasColour, ['#5a5a5a', '#b4b4b4', '#000000', '#ffffff']);

  return (
    <div
      className={styles.root}
      ref={rootCallback}
      /*
       * Pressing the empty canvas leaves focus mode.
       *
       * This lived on the transformed layer and did the opposite of what it
       * says. The layer has no size of its own, so it is never the direct
       * target of a press and a click on the background never reached it;
       * what did reach it was every press inside a focused screen, bubbling
       * up, which threw you out of the mode on the first thing you clicked.
       * So focus mode could not be used and could not be left, from one
       * missing target check.
       *
       * The test is the one the panning code already uses: the root itself, or
       * something explicitly marked as canvas background. Chrome and frames are
       * neither, so the HUD and the screen both keep their presses.
       */
      /*
       * The rules and guides get the press before anything under them, and
       * give it straight back unless it landed in a gutter or on a guide.
       *
       * This used to live on the ruler canvas itself, with `pointer-events:
       * auto` while the rules were showing. That canvas is the size of the
       * whole viewport, so turning the rules on made every screen unclickable:
       * no selecting, no dragging, no double-clicking in. The handler declined
       * the press correctly and it made no difference, because the element had
       * already swallowed it.
       *
       * Capture phase rather than bubble, because a guide drawn over a frame
       * has to win against that frame's shield, and bubble would reach the
       * shield first.
       */
      onPointerDownCapture={onRulerPointerDown}
      onPointerDown={(e) => {
        if (modeRef.current !== 'focus') return;
        const t = e.target as HTMLElement;
        const onBackground = t === e.currentTarget
          || t.dataset['canvasBackground'] !== undefined
          // The dim overlay over every other screen. It belongs to that
          // screen's group, so it is neither the root nor the layer, and
          // without naming it a press on a dimmed neighbour did nothing.
          || t.dataset['dim'] !== undefined;
        if (onBackground) exitLock();
      }}
      /* The tokens hang off this, not off :root, so a screen mounted inside the
         canvas never inherits chrome tokens by accident. */
      data-lab-root=""
      data-mode={mode}
      /*
       * Chrome that sits directly on the canvas flips with the canvas's own
       * luminance. Measured, not assumed: a fixed grey label reads 6.1:1 on
       * the default background and 1.75:1 on a mid grey, and the canvas colour
       * is a control the user can reach.
       */
      data-canvas-theme={canvasTheme}
      style={{
        ['--canvas' as string]: canvasColour,
        ['--label' as string]: labelColour,
      }}
    >
      <canvas className={styles.grid} ref={gridRef} aria-hidden="true" />
      <canvas className={styles.measure} ref={measureRef} aria-hidden="true" />
      <div ref={keysCallback} hidden />

      <div
        className={styles.layer}
        ref={layerCallback}
        data-canvas-background=""
      >
        <div className={styles.ghost} ref={ghostRef} style={{ display: 'none' }} />

        {SCREENS.map((def) => {
          const box = layout[def.id];
          if (!box) return null;
          // Fill borrows the window's size for the duration. The stored layout
          // is untouched, so leaving fill restores the real size with nothing
          // to undo.
          const filling = mode === 'fill' && activeId === def.id;
          const size = filling ? windowSize : { width: box.width, height: box.height };
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
              onSelect={select}
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
      />

      <div className={styles.chrome} ref={chromeRef}>
        <Toasts />
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
            onPointerDown={(e) => {
              e.stopPropagation();
              select(def.id);
              // A label is a handle on its frame: dragging it moves the frame,
              // which is how you grab a screen that fills the viewport and has
              // no free edge to catch.
              onDragStart(def.id, e);
            }}
            onDoubleClick={() => {
              // Renames, per the spec's key map. The lock-in gesture is a
              // double-click on the frame itself, which is a different target.
              const next = window.prompt('Rename this screen', def.name);
              if (!next || next === def.name) return;
              void labFs.rename(def.dir, next).then((ok) => {
                if (!ok) { toast('Could not rename: no dev server', 'warn'); return; }
                location.reload();
              });
            }}
          >
            {def.name}
          </div>
        ))}

        {mode !== 'explore' && (
          <button
            type="button"
            className={styles.play}
            ref={playRef}
            data-screen-id={activeId ?? undefined}
            title={mode === 'fill'
              ? 'Back to the frame (Shift F)'
              : 'Give this screen the whole window (Shift F)'}
            aria-label={mode === 'fill'
              ? 'Back to the frame'
              : 'Give this screen the whole window'}
            onClick={() => (mode === 'fill' ? exitFill() : activeId && enterFill(activeId))}
          >
            <Icon name={mode === 'fill' ? 'minimize' : 'maximize'} size={14} strokeWidth={2} />
          </button>
        )}

        <div className={styles.hud}>
          <button
            type="button"
            className={styles.hudButton}
            onClick={fitAll}
            title="Zoom to fit everything (Shift 1)"
          >
            <Icon name="fit" />
            {zoomLabel}%
          </button>
          {mode !== 'explore' && (
            <>
              <span className={styles.hudDivider} />
              <span className={styles.hudBadge}>
                <b>{activeName}</b>
                {mode === 'fill' ? ' · filling · Esc for the frame' : ' · Esc to exit'}
              </span>

            </>
          )}
          <span className={styles.hudDivider} />
          <div className={styles.colour}>
            <button
              type="button"
              className={styles.hudSwatch}
              title="Canvas colour"
              aria-label="Canvas colour"
              aria-haspopup="dialog"
              aria-expanded={colourOpen}
              data-on={colourOpen || undefined}
              onClick={() => { setHexDraft(canvasColour); setColourOpen((v) => !v); }}
            >
              <span style={{ background: canvasColour }} />
            </button>

            {colourOpen && (
              <div className={styles.colourPopover} role="dialog" aria-label="Canvas colour">
                <input
                  type="color"
                  className={styles.colourPicker}
                  aria-label="Pick a canvas colour"
                  value={canvasColour}
                  onChange={(e) => applyColour(e.target.value)}
                />
                <form
                  className={styles.colourRow}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const hex = normaliseHex(hexDraft);
                    if (!hex) { toast('That is not a hex colour', 'warn'); return; }
                    applyColour(hex);
                    const next = addSwatch(swatches, hex);
                    setSwatches(next);
                    saveSwatches(next);
                  }}
                >
                  <input
                    className={styles.hexField}
                    value={hexDraft}
                    spellCheck={false}
                    placeholder="#1a1a1a"
                    aria-label="Canvas colour, as hex"
                    onChange={(e) => setHexDraft(e.target.value)}
                  />
                  <button type="submit" className={`${styles.hudButton} ${styles.saveButton}`}>Save</button>
                </form>

                {/* No presets. The row fills with colours you chose, which
                    after a day of use beats anyone else's defaults. */}
                {swatches.length > 0 && (
                  <div className={styles.swatchRow}>
                    {swatches.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={styles.swatch}
                        style={{ background: c }}
                        title={c}
                        aria-label={`Use ${c}`}
                        onClick={() => applyColour(c)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            className={styles.hudButton}
            data-on={showGrid || undefined}
            aria-pressed={showGrid}
            onClick={() => { setShowGrid((v) => !v); requestAnimationFrame(() => paintGrid()); }}
            title="The pixel grid, ten units"
          >
            <Icon name="grid" />
            Grid
          </button>
          <button
            type="button"
            className={styles.hudButton}
            data-on={showRulers || undefined}
            aria-pressed={showRulers}
            onClick={() => {
              setShowRulers((v) => { showRulersRef.current = !v; return !v; });
              requestAnimationFrame(() => paintRulerRef.current?.());
            }}
            title="Rulers and guides (Shift R). Drag out of a rule to place one"
          >
            <Icon name="rulers" />
            Rulers
          </button>
          <button
            type="button"
            className={styles.hudButton}
            onClick={resetLayout}
            title="Put every screen back where the registry says (Ctrl/Cmd Shift Backspace)"
          >
            <Icon name="reset" />
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

export { screenToPage, viewportCentre };
