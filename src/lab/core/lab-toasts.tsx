import { useCallback, useSyncExternalStore } from 'react';
import styles from './lab.module.css';
import { Icon } from './icons';
import { EXIT_MS } from './theme';

/**
 * A small toast store, because three things in this lab can fail silently and
 * a silent failure is indistinguishable from a broken feature.
 *
 * The file operations are the reason. Undoing a delete whose folder has since
 * changed on disk cannot succeed, and without a word about it the user presses
 * Ctrl+Z, watches nothing happen, and presses it again. Same for a duplicate
 * in a production build, where there is no dev server to ask.
 *
 * A module store rather than context: a toast fired before the renderer mounts
 * just waits in the store, so nothing needs a queue or a ready check.
 */

export interface Toast {
  id: number;
  text: string;
  tone: 'note' | 'warn';
  /** Set while the exit transition runs, then the row is dropped. */
  leaving?: boolean;
}

const LIFETIME_MS = 4000;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/**
 * Start the exit, then remove.
 *
 * The row has to stay in the DOM for the length of the transition or there is
 * no exit at all, only a disappearance. Idempotent, so a dismiss during the
 * automatic expiry does not schedule a second removal.
 */
export function dismiss(id: number): void {
  const found = toasts.find((t) => t.id === id);
  if (!found || found.leaving) return;
  toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, EXIT_MS);
}

/**
 * A note reports something that worked and expires on its own. A warning
 * reports something that did not, and stays until it is dismissed: an error
 * that times out is an error the user can miss entirely, and every warning in
 * this lab is the result of a file operation they asked for.
 */
export function toast(text: string, tone: Toast['tone'] = 'note'): void {
  const id = nextId;
  nextId += 1;
  toasts = [...toasts, { id, text, tone }];
  emit();
  if (tone === 'note') setTimeout(() => dismiss(id), LIFETIME_MS);
}

/**
 * A message that has to survive the reload the file operations trigger, so the
 * result of an operation is still reported after the page comes back.
 */
const PENDING = 'interaction-lab:toast:v1';

export function toastAfterReload(text: string, tone: Toast['tone'] = 'note'): void {
  try { sessionStorage.setItem(PENDING, JSON.stringify({ text, tone })); } catch { /* disabled */ }
}

export function drainPendingToast(): void {
  try {
    const raw = sessionStorage.getItem(PENDING);
    if (!raw) return;
    sessionStorage.removeItem(PENDING);
    const data = JSON.parse(raw) as { text?: unknown; tone?: unknown };
    if (typeof data.text === 'string') {
      toast(data.text, data.tone === 'warn' ? 'warn' : 'note');
    }
  } catch { /* nothing worth reporting about a failed report */ }
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

/**
 * Two live regions, always mounted, never conditional.
 *
 * A polite region inserted at the same moment as its first message is
 * announced inconsistently across screen readers; one that already exists and
 * merely gains text is not. So the container renders even when empty.
 *
 * The split is by urgency, which is the only thing the two roles differ on:
 * `status` for a note, which is a result the user is welcome to miss, and
 * `alert` for a warning, which is a file operation that did not happen.
 */
export function Toasts() {
  const list = useSyncExternalStore(
    useCallback(subscribe, []),
    () => toasts,
    () => toasts,
  );

  const render = (t: Toast) => (
    <div key={t.id} className={styles.toast} data-tone={t.tone} data-leaving={t.leaving || undefined}>
      {/*
        * Only the warning carries a glyph. A note is as often a hint ("double
        * click a screen to use it") as a result, and a tick beside a hint
        * claims something succeeded that never happened. The redundant cue is
        * owed where meaning rides on colour, which is the warning and only the
        * warning.
        */}
      {t.tone === 'warn' && (
        <span className={styles.toastIcon}>
          <Icon name="warn" size={14} />
        </span>
      )}
      {t.text}
      {t.tone === 'warn' && (
        <button
          type="button"
          className={styles.toastClose}
          aria-label="Dismiss"
          onClick={() => dismiss(t.id)}
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );

  return (
    <div className={styles.toasts}>
      <div className={styles.toastGroup} role="status" aria-live="polite">
        {list.filter((t) => t.tone === 'note').map(render)}
      </div>
      <div className={styles.toastGroup} role="alert">
        {list.filter((t) => t.tone === 'warn').map(render)}
      </div>
    </div>
  );
}
