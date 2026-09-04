import { useCallback, useRef, useState } from 'react';
import { useScreen } from '../../lab';
import styles from './stress.module.css';

/**
 * The hard cases, for the screen contract.
 *
 * Every section here exists because some part of the contract is easy to get
 * wrong from inside a screen, and the failure is usually silent: the numbers
 * are merely wrong rather than absent, which is much harder to notice. Each
 * section states what the right answer is, so you can check rather than
 * remember.
 *
 * The rule this page is really testing: a screen may not ask the window
 * anything. Not its size, not its scroll, not where a pointer is. The frame is
 * translated and scaled by an ancestor, so every one of those answers is wrong
 * by the camera.
 */

const ROWS = Array.from({ length: 30 }, (_, i) => i);

export function StressScreen() {
  const { screenId, active, visible, frameSize, zoom, clientToFrame, setEscapeInterceptor } = useScreen();

  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [raw, setRaw] = useState<{ x: number; y: number } | null>(null);
  const [scroll, setScroll] = useState(0);
  const [dialog, setDialog] = useState(false);
  const [keys, setKeys] = useState<string[]>([]);
  const [frames, setFrames] = useState(0);
  const [dragged, setDragged] = useState({ x: 40, y: 40 });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);

  /** Escape belongs to the dialog while it is open, and to the lab otherwise. */
  const escapeCallback = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el;
    if (!el) return undefined;
    setEscapeInterceptor(() => {
      if (!dialog) return false;
      setDialog(false);
      return true;
    });
    return () => setEscapeInterceptor(null);
  }, [dialog, setEscapeInterceptor]);

  /**
   * A shortcut that only exists while this screen is locked into.
   *
   * Without the `active` gate, every mounted screen would answer the same
   * keystroke at once, including the ones you are only looking at.
   */
  const keysCallback = useCallback((el: HTMLDivElement | null) => {
    if (!el) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (!active) return;
      if (e.key.length !== 1) return;
      setKeys((prev) => [e.key, ...prev].slice(0, 8));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  /**
   * A rAF loop that must cost nothing when the screen is culled or not in use.
   * A canvas full of screens each burning a frame loop is the failure mode
   * culling exists to prevent, and `visible` is how a screen hears about it.
   */
  const runnerCallback = useCallback((el: HTMLDivElement | null) => {
    if (!el) return undefined;
    let live = true;
    const tick = () => {
      if (!live) return;
      if (visible && active && document.visibilityState === 'visible') {
        setFrames((n) => n + 1);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { live = false; cancelAnimationFrame(rafRef.current); };
  }, [active, visible]);

  /** Both readings, side by side, so the wrong one is visible as wrong. */
  const onPointerMove = (e: React.PointerEvent) => {
    if (!active) return;
    setPointer(clientToFrame(e));
    setRaw({ x: e.clientX, y: e.clientY });
  };

  /** A drag that must track the pointer exactly, at any zoom. */
  const onHandleDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const start = clientToFrame(e);
    const from = { ...dragged };
    const move = (ev: PointerEvent) => {
      const at = clientToFrame(ev);
      setDragged({ x: from.x + (at.x - start.x), y: from.y + (at.y - start.y) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // Window, not the element: a drag that leaves the box must keep tracking.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      className={styles.screen}
      ref={escapeCallback}
      onPointerMove={onPointerMove}
      onPointerLeave={() => { setPointer(null); setRaw(null); }}
    >
      <div ref={keysCallback} hidden />
      <div ref={runnerCallback} hidden />

      <header className={styles.header}>
        <h1>The hard cases</h1>
        <p>
          Every reading below comes from the contract. Where a section shows two
          numbers, the second is what the window would have told you, and it is
          wrong on purpose.
        </p>
      </header>

      <section>
        <h2>1 · What the lab tells this screen</h2>
        <dl className={styles.readout}>
          <dt>screenId</dt><dd>{screenId}</dd>
          <dt>active</dt><dd data-flag={active || undefined}>{String(active)}</dd>
          <dt>visible</dt><dd data-flag={visible || undefined}>{String(visible)}</dd>
          <dt>frameSize</dt><dd>{Math.round(frameSize.width)} × {Math.round(frameSize.height)}</dd>
          <dt>zoom</dt><dd>{Math.round(zoom * 100)}%</dd>
        </dl>
        <table className={styles.expect}>
          <tbody>
            <tr><th>frameSize</th><td>tracks the frame</td><td>resize the frame and it changes; resize the window and it does not</td></tr>
            <tr><th>visible</th><td>false when culled</td><td>pan the frame far off screen and come back</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>2 · Pointer coordinates</h2>
        <p>Lock in and move the pointer over this screen.</p>
        <dl className={styles.readout}>
          <dt>clientToFrame</dt>
          <dd>{pointer ? `${Math.round(pointer.x)}, ${Math.round(pointer.y)}` : 'move the pointer'}</dd>
          <dt>raw clientX/Y</dt>
          <dd data-wrong>{raw ? `${Math.round(raw.x)}, ${Math.round(raw.y)}` : '—'}</dd>
        </dl>
        <table className={styles.expect}>
          <tbody>
            <tr><th>top-left of this screen</th><td>near 0, 0</td><td>whatever the zoom and wherever the canvas is panned</td></tr>
            <tr><th>the raw pair</th><td>never 0, 0</td><td>it is a window coordinate, off by the camera. That is the bug this exists to make visible</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>3 · A drag that must not drift</h2>
        <p>Drag the square. It has to stay under the pointer at 25% and at 200%.</p>
        <div className={styles.dragArea}>
          <div
            className={styles.handle}
            style={{ transform: `translate(${dragged.x}px, ${dragged.y}px)` }}
            onPointerDown={onHandleDown}
          >
            {Math.round(dragged.x)}, {Math.round(dragged.y)}
          </div>
        </div>
        <table className={styles.expect}>
          <tbody>
            <tr><th>at any zoom</th><td>square stays under the pointer</td><td>because the delta is measured in frame units, not screen ones</td></tr>
            <tr><th>drag outside the frame</th><td>keeps tracking</td><td>the listeners are on the window; only the maths is frame-local</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>4 · Its own scroll</h2>
        <p>
          The window never scrolls: the lab root is fixed. This frame has a
          scroll container of its own, and <code>scrollTop</code> is the only
          honest source.
        </p>
        <div
          className={styles.scroller}
          onScroll={(e) => setScroll(Math.round(e.currentTarget.scrollTop))}
        >
          {ROWS.map((i) => <div key={i} className={styles.row}>row {i}</div>)}
        </div>
        <dl className={styles.readout}>
          <dt>container scrollTop</dt><dd>{scroll}</dd>
          <dt>window.scrollY</dt><dd data-wrong>{typeof window === 'undefined' ? '—' : window.scrollY}</dd>
        </dl>
        <table className={styles.expect}>
          <tbody>
            <tr><th>window.scrollY</th><td>always 0</td><td>which is why a screen that reads it silently measures nothing</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>5 · Keys, and who owns them</h2>
        <p>Type letters. They are only recorded while this screen is locked into.</p>
        <div className={styles.keys}>
          {keys.length ? keys.map((k, i) => <kbd key={i}>{k}</kbd>) : <span>nothing yet</span>}
        </div>
        <table className={styles.expect}>
          <tbody>
            <tr><th>while exploring</th><td>records nothing</td><td>the listener is gated on active</td></tr>
            <tr><th>locked in</th><td>records every letter</td><td>and the lab keeps only Esc for itself</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>6 · Work that must stop</h2>
        <p>A frame loop that only runs while this screen is both visible and in use.</p>
        <dl className={styles.readout}>
          <dt>frames counted</dt><dd>{frames}</dd>
        </dl>
        <table className={styles.expect}>
          <tbody>
            <tr><th>exploring</th><td>frozen</td><td>a canvas of screens each burning a loop is what culling prevents</td></tr>
            <tr><th>culled</th><td>frozen</td><td>content-visibility does not pause JavaScript; the screen has to</td></tr>
            <tr><th>tab hidden</th><td>frozen</td><td></td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>7 · Who gets Escape</h2>
        <p>Open the dialog, then press Escape twice.</p>
        <button type="button" className={styles.button} onClick={() => setDialog(true)}>
          Open a dialog
        </button>
        {dialog && (
          <div className={styles.dialog}>
            <p>The first Escape closes this. The second exits the screen.</p>
            <button type="button" onClick={() => setDialog(false)}>Close</button>
          </div>
        )}
        <table className={styles.expect}>
          <tbody>
            <tr><th>first Escape</th><td>closes the dialog</td><td>the screen claimed it and returned true</td></tr>
            <tr><th>second Escape</th><td>exits lock-in</td><td>nothing left to close, so the lab takes it</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>8 · Long content</h2>
        <p>
          Below the fold, so the frame has something to scroll and the culling
          has something to keep mounted. The state above survives being culled;
          that is the whole reason frames are hidden rather than unmounted.
        </p>
        <div className={styles.filler}>
          {ROWS.map((i) => <div key={i} className={styles.block}>block {i}</div>)}
        </div>
      </section>
    </div>
  );
}
