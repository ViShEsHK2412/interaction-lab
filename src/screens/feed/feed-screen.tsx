import { useCallback, useRef, useState } from 'react';
import { useScreen } from '../../lab';
import styles from './feed.module.css';

/**
 * A screen that exercises the parts of the contract that are easy to get
 * wrong: it scrolls, it tracks the pointer, it owns a keyboard shortcut, and
 * it has something to close on Escape.
 *
 * Nothing in here reads `window.innerWidth`, `scrollY`, or a client rect of
 * its own. That is the whole discipline the contract asks for.
 */

const POSTS = Array.from({ length: 14 }, (_, i) => ({
  id: i,
  author: ['Ada', 'Grace', 'Alan', 'Edsger', 'Barbara'][i % 5]!,
  body: [
    'The canvas is a hundred lines of arithmetic and you should own them.',
    'Zoom about a point is one formula. Everything else is bookkeeping.',
    'A camera that renders React on every wheel event drops frames.',
    'Fit never zooms past 100%, because fit is not magnify.',
    'Interpolate zoom in log space or the animation lurches.',
  ][i % 5]!,
  likes: (i * 7) % 23,
}));

export function FeedScreen() {
  const { active, frameSize, clientToFrame, setEscapeInterceptor } = useScreen();
  const [open, setOpen] = useState<number | null>(null);
  const [liked, setLiked] = useState<Record<number, boolean>>({});
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /**
   * Escape belongs to whatever is open. The lab asks first and only exits
   * lock-in if this says it had nothing to close.
   */
  const escapeCallback = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el;
    if (!el) return undefined;
    setEscapeInterceptor(() => {
      if (open === null) return false;
      setOpen(null);
      return true;
    });
    return () => setEscapeInterceptor(null);
  }, [open, setEscapeInterceptor]);

  /**
   * Pointer positions come from the contract, never from clientX directly.
   * The frame is scaled by an ancestor, so a raw clientX is off by the zoom
   * and by wherever the canvas happens to be panned to.
   */
  const onPointerMove = (e: React.PointerEvent) => {
    if (!active) return;
    setPointer(clientToFrame(e));
  };

  return (
    <div
      className={styles.screen}
      ref={escapeCallback}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setPointer(null)}
    >
      <header className={styles.header}>
        <h1>Feed</h1>
        <span className={styles.meta}>
          {frameSize.width} × {frameSize.height}
          {pointer ? ` · pointer ${Math.round(pointer.x)}, ${Math.round(pointer.y)}` : ''}
        </span>
      </header>

      <ul className={styles.list}>
        {POSTS.map((post) => (
          <li key={post.id} className={styles.post}>
            <button
              type="button"
              className={styles.body}
              onClick={() => setOpen(post.id)}
            >
              <b>{post.author}</b>
              <span>{post.body}</span>
            </button>
            <button
              type="button"
              className={styles.like}
              data-on={liked[post.id] || undefined}
              onClick={() => setLiked((p) => ({ ...p, [post.id]: !p[post.id] }))}
            >
              ♥ {post.likes + (liked[post.id] ? 1 : 0)}
            </button>
          </li>
        ))}
      </ul>

      {open !== null && (
        <div className={styles.sheet}>
          <p>{POSTS.find((p) => p.id === open)?.body}</p>
          <button type="button" onClick={() => setOpen(null)}>Close</button>
          <span className={styles.hint}>Escape closes this before it exits the screen</span>
        </div>
      )}
    </div>
  );
}
