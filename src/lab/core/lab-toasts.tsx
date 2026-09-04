import { useCallback, useSyncExternalStore } from 'react';
import styles from './lab.module.css';

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
}

const LIFETIME_MS = 4000;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function toast(text: string, tone: Toast['tone'] = 'note'): void {
  const id = nextId;
  nextId += 1;
  toasts = [...toasts, { id, text, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, LIFETIME_MS);
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

export function Toasts() {
  const list = useSyncExternalStore(
    useCallback(subscribe, []),
    () => toasts,
    () => toasts,
  );
  if (list.length === 0) return null;
  return (
    <div className={styles.toasts}>
      {list.map((t) => (
        <div key={t.id} className={styles.toast} data-tone={t.tone}>{t.text}</div>
      ))}
    </div>
  );
}
