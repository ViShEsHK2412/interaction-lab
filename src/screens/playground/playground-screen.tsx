import { useScreen } from '../../lab';
import styles from './playground.module.css';

/**
 * The second screen exists to prove multi-screen works, and to make the
 * contract's reactive values visible: everything it prints comes from
 * `useScreen`, so if the lab ever lies to a screen you can see it here.
 */
export function PlaygroundScreen() {
  const { screenId, active, visible, frameSize, zoom } = useScreen();

  return (
    <div className={styles.screen}>
      <h1>Playground</h1>
      <p>Two screens, one canvas. Everything below is what the lab tells this one.</p>

      <dl className={styles.readout}>
        <dt>screenId</dt><dd>{screenId}</dd>
        <dt>active</dt><dd>{String(active)}</dd>
        <dt>visible</dt><dd>{String(visible)}</dd>
        <dt>frameSize</dt><dd>{frameSize.width} × {frameSize.height}</dd>
        <dt>zoom</dt><dd>{Math.round(zoom * 100)}%</dd>
      </dl>

      <p className={styles.note}>
        <code>active</code> is false until you double-click in. Until then this screen
        is inert: a shield over the frame takes every click so the canvas can use it
        for selecting and dragging.
      </p>

      <div className={styles.swatches}>
        {['#0d99ff', '#f24822', '#14ae5c', '#ffcd29', '#9747ff'].map((c) => (
          <button key={c} type="button" style={{ background: c }} title={c} />
        ))}
      </div>
    </div>
  );
}
