import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ScreenProvider, type ScreenState } from '../screen-context';
import type { Handle } from './snapping';
import type { ScreenDef } from '../screens';
import styles from './lab.module.css';

export interface FrameProps {
  def: ScreenDef;
  position: { x: number; y: number };
  size: { width: number; height: number };
  selected: boolean;
  /** Locked into this one: it owns the pointer and the keyboard. */
  active: boolean;
  /** Some other screen is locked into, so this one is dimmed out of the way. */
  dimmed: boolean;
  visible: boolean;
  zoom: number;
  /** Canvas rect and camera, read at event time so mid-animation maths stays exact. */
  readCanvas: () => { rect: DOMRect; z: number };
  onSelect: (id: string) => void;
  onLockIn: (id: string) => void;
  onDragStart: (id: string, e: React.PointerEvent) => void;
  onResizeStart: (id: string, handle: Handle, e: React.PointerEvent) => void;
  registerEscape: (id: string, fn: (() => boolean) | null) => void;
}

/**
 * One frame: a fixed-size viewport onto a screen.
 *
 * The group carries position and size and the frame fills it, which is not an
 * arbitrary split. The frame clips and contains its content, so anything
 * placed on the frame that straddles its edge, a resize handle for instance,
 * gets swallowed. Handles have to live on the group.
 */
function ScreenFrameInner(props: FrameProps) {
  const {
    def, position, size, selected, active, dimmed, visible, zoom,
    readCanvas, onSelect, onLockIn, onDragStart, onResizeStart, registerEscape,
  } = props;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState(size);

  /**
   * One ResizeObserver, owned by the frame rather than by the screen.
   *
   * React attaches refs bottom-up, so a screen's own layout effect runs before
   * its ancestor frame exists. A screen that tried to observe itself would
   * measure nothing on the pass that matters. The frame observes, and every
   * screen gets one guaranteed delivery after the refs are in place.
   */
  const scrollCallback = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      // A zero box is a culled frame, not a real measurement. Building
      // anything from it produces geometry that is wrong by the whole frame.
      if (!box || box.width === 0 || box.height === 0) return;
      setMeasured({ width: box.width, height: box.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * A client point in frame-local page units.
   *
   * Derives the scale from the DOM rather than from the camera store, because
   * around mount the store already holds the restored zoom while the layer's
   * transform has not been written yet, and the mismatch puts everything a
   * whole factor out.
   */
  const clientToFrame = useCallback((p: { clientX: number; clientY: number }) => {
    const el = scrollRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const scale = r.width > 0 && el.clientWidth > 0 ? r.width / el.clientWidth : readCanvas().z;
    return {
      x: (p.clientX - r.left) / scale + el.scrollLeft,
      y: (p.clientY - r.top) / scale + el.scrollTop,
    };
  }, [readCanvas]);

  const setEscapeInterceptor = useCallback(
    (fn: (() => boolean) | null) => registerEscape(def.id, fn),
    [def.id, registerEscape],
  );

  /**
   * Selection is deliberately not in here. It changes on every click and would
   * re-render the whole screen subtree for a ring the frame draws itself.
   */
  const env: ScreenState = useMemo(() => ({
    screenId: def.id,
    active,
    visible,
    frameSize: measured,
    zoom,
    clientToFrame,
    setEscapeInterceptor,
  }), [def.id, active, visible, measured, zoom, clientToFrame, setEscapeInterceptor]);

  const Component = def.component;
  const content = useMemo(() => <Component />, [Component]);

  return (
    <div
      className={styles.group}
      data-screen-id={def.id}
      data-selected={selected || undefined}
      data-active={active || undefined}
      data-culled={!visible || undefined}
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        width: size.width,
        height: size.height,
      }}
    >
      <div className={styles.frame}>
        <div className={styles.scroll} ref={scrollCallback} tabIndex={active ? 0 : -1}>
          <ScreenProvider value={env}>{content}</ScreenProvider>
        </div>

        {/*
          The shield. In explore mode every frame is covered by this, so a
          click selects the frame instead of pressing a button inside a screen
          you were only looking at. Content also gets pointer-events: none in
          CSS, which is belt and braces rather than redundancy: it is what
          would keep an iframe screen inert later, where a shield alone is not
          enough on Safari.
        */}
        {!active && (
          <div
            className={styles.shield}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              onSelect(def.id);
              onDragStart(def.id, e);
            }}
            onDoubleClick={() => onLockIn(def.id)}
          />
        )}

        {dimmed && <div className={styles.dim} />}
      </div>

      {/*
        On the group, outside the frame. The frame clips and contains its
        content, so a handle straddling its edge, which is what every edge
        handle does, would be swallowed by the clip.
      */}
      {selected && !active && (
        <div className={styles.handles}>
          {(['n', 's', 'e', 'w'] as const).map((dir) => (
            <div
              key={dir}
              className={styles.edge}
              data-dir={dir}
              onPointerDown={(e) => onResizeStart(def.id, dir, e)}
            />
          ))}
          {(['nw', 'ne', 'sw', 'se'] as const).map((dir) => (
            <div
              key={dir}
              className={styles.corner}
              data-dir={dir}
              onPointerDown={(e) => onResizeStart(def.id, dir, e)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Memoised on props: the shell re-renders on selection and mode changes, and
 * without this every screen subtree would re-render with it.
 */
export const ScreenFrame = memo(ScreenFrameInner);
