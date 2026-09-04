import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  boundsOf, boxesIntersect, createCameraStore, lerpCamera, screenToPage, stepZoom,
  snapToDevicePixels, toDomPrecision, viewportCentre, visibleBounds, zoomAbout,
  zoomToBounds, type Box, type Camera,
} from './core/camera';
import { bindCanvasInput, transformFor } from './core/use-canvas-input';
import { clearLayout, createSaver, loadLayout, type StoredLayout } from './core/persistence';
import { ScreenFrame } from './core/screen-frame';
import { SCREENS } from './screens';
import styles from './core/lab.module.css';

/** How long the camera takes to travel, and the pause that counts as settled. */
const ANIM_MS = 320;
const IDLE_MS = 160;

type Mode = 'explore' | 'focus';
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
  const boot = useRef<{ stored: StoredLayout | null; layout: Layout; camera: Camera } | null>(null);
  if (!boot.current) {
    const stored = loadLayout(ids);
    const layout = resolveLayout(stored);
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
  const animRef = useRef<number>(0);
  const frameRef = useRef<number>(0);
  const idleRef = useRef<number>(0);
  const gesturingRef = useRef(false);

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
    const back = exploreCameraRef.current;
    exploreCameraRef.current = null;
    if (back) animateTo(back);
  }, [animateTo]);

  const registerEscape = useCallback((id: string, fn: (() => boolean) | null) => {
    if (fn) escapeRef.current.set(id, fn);
    else escapeRef.current.delete(id);
  }, []);

  // ── Frame dragging ────────────────────────────────────────────────────────

  const dragRef = useRef<{ id: string; startX: number; startY: number; box: Box } | null>(null);

  const onDragStart = useCallback((id: string, e: React.PointerEvent) => {
    const box = layoutRef.current[id];
    if (!box || modeRef.current !== 'explore') return;
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, box: { ...box } };

    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const z = store.get().z;
      const next = {
        ...d.box,
        // Whole page units. Free dragging otherwise leaves frames on
        // fractional positions, which is where the "why is this half a pixel
        // out" class of confusion comes from.
        x: Math.round(d.box.x + (ev.clientX - d.startX) / z),
        y: Math.round(d.box.y + (ev.clientY - d.startY) / z),
      };
      layoutRef.current = { ...layoutRef.current, [d.id]: next };
      const el = document.querySelector<HTMLElement>(`[data-screen-id="${d.id}"]`);
      if (el) el.style.transform = `translate(${next.x}px, ${next.y}px)`;
      applyCamera(store.get(), false);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      // React hears about it once, at the end. Not sixty times a second.
      setLayout({ ...layoutRef.current });
      persist();
      recull();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [applyCamera, persist, recull, store]);

  // ── Element wiring, all through ref callbacks ─────────────────────────────

  const rootCallback = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el;
    if (!el) return undefined;

    const measure = () => {
      rectRef.current = el.getBoundingClientRect();
      recull();                      // now with a real rect, unlike at mount
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
  }, [markMoved, recull, saver, store, viewport]);

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
      if (modeRef.current === 'focus') {
        if (e.key === 'Escape') {
          const claim = activeId ? escapeRef.current.get(activeId) : undefined;
          if (claim && claim()) return;       // the screen had something to close
          e.preventDefault();
          exitLock();
        } else if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) {
          e.preventDefault();
          exitLock();
          fitAll();
        }
        return;
      }

      const centre = () => {
        const r = rectRef.current;
        return { x: r.width / 2, y: r.height / 2 };
      };

      if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); fitAll(); }
      else if (e.shiftKey && e.code === 'Digit2') {
        e.preventDefault();
        const box = selectedRef.current ? layoutRef.current[selectedRef.current] : null;
        if (box) fitTo([box]);
      } else if (e.shiftKey && e.code === 'Digit0') {
        e.preventDefault();
        const p = centre();
        animateTo(zoomAbout(store.get(), p.x, p.y, 1));
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
        setLayout((prev) => ({ ...prev, [id]: { ...box, x: box.x + dx, y: box.y + dy } }));
      }
    };

    // Capture, so a focused screen cannot swallow Escape before the lab sees it.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activeId, animateTo, exitLock, fitAll, fitTo, lockInto, store]);

  // Layout changes from the keyboard still have to reach the DOM and storage.
  layoutRef.current = layout;

  const zoomLabel = useSyncExternalStore(
    useCallback((fn: () => void) => store.subscribe(fn), [store]),
    () => Math.round(store.get().z * 100),
  );

  const activeName = SCREENS.find((s) => s.id === activeId)?.name ?? '';

  return (
    <div className={styles.root} ref={rootCallback} data-mode={mode}>
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
          return (
            <ScreenFrame
              key={def.id}
              def={def}
              position={{ x: box.x, y: box.y }}
              size={{ width: box.width, height: box.height }}
              selected={selected === def.id}
              active={activeId === def.id}
              dimmed={mode === 'focus' && activeId !== def.id}
              visible={!culled[def.id]}
              zoom={zoomLabel / 100}
              readCanvas={readCanvas}
              onSelect={setSelected}
              onLockIn={lockInto}
              onDragStart={onDragStart}
              registerEscape={registerEscape}
            />
          );
        })}
      </div>

      <div className={styles.chrome} ref={chromeRef}>
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
          {mode === 'focus' && (
            <>
              <span className={styles.hudDivider} />
              <span className={styles.hudBadge}>
                <b>{activeName}</b> · Esc to exit
              </span>
            </>
          )}
          <span className={styles.hudDivider} />
          <button
            type="button"
            className={styles.hudButton}
            onClick={() => {
              clearLayout();
              const fresh = resolveLayout(null);
              layoutRef.current = fresh;
              setLayout(fresh);
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
