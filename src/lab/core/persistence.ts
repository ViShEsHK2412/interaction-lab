import type { Camera } from './camera';

/**
 * What survives a reload: where the camera was, and where you put things.
 *
 * Positions are stored as overrides on top of the registry's defaults rather
 * than as the whole layout, so a screen whose default moves in code follows
 * the code until someone drags it, and only then stops.
 */

const KEY = 'interaction-lab:v1';
const SAVE_DELAY = 300;

export interface StoredLayout {
  camera: Camera;
  /** Overrides, keyed by screen id. Unknown ids are dropped on read. */
  screens: Record<string, { x: number; y: number; width?: number; height?: number }>;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Every field is checked, because this is user-editable text that arrives from
 * a previous version of the software. A stale or hand-edited value must fail
 * to load, never throw at startup and take the whole canvas with it.
 */
export function parseStored(raw: string | null, knownIds: readonly string[]): StoredLayout | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const { camera, screens } = data as { camera?: unknown; screens?: unknown };

  if (typeof camera !== 'object' || camera === null) return null;
  const { x, y, z } = camera as { x?: unknown; y?: unknown; z?: unknown };
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z) || z <= 0) return null;

  const out: StoredLayout = { camera: { x, y, z }, screens: {} };
  if (typeof screens === 'object' && screens !== null) {
    for (const [id, value] of Object.entries(screens as Record<string, unknown>)) {
      if (!knownIds.includes(id)) continue;          // a screen that no longer exists
      if (typeof value !== 'object' || value === null) continue;
      const v = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
      if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y)) continue;
      const entry: StoredLayout['screens'][string] = { x: v.x, y: v.y };
      if (isFiniteNumber(v.width) && v.width > 0) entry.width = v.width;
      if (isFiniteNumber(v.height) && v.height > 0) entry.height = v.height;
      out.screens[id] = entry;
    }
  }
  return out;
}

export function loadLayout(knownIds: readonly string[]): StoredLayout | null {
  try {
    return parseStored(localStorage.getItem(KEY), knownIds);
  } catch {
    return null;                                     // private mode, or storage disabled
  }
}

function write(layout: StoredLayout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    /* quota, or storage disabled. Losing the layout is not worth an exception. */
  }
}

export function clearLayout(): void {
  try {
    localStorage.removeItem(KEY);
  } catch { /* as above */ }
}

/**
 * Debounced, because a pan writes a new camera on every frame and none of the
 * intermediate ones are worth keeping. `saveNow` exists for `pagehide`: the
 * page can go away between the last gesture and the timer, and "where I
 * stopped" is exactly what the timer would lose.
 */
export function createSaver(): { save(layout: StoredLayout): void; saveNow(): void } {
  let pending: StoredLayout | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (pending) { write(pending); pending = null; }
  };

  return {
    save(layout) {
      pending = layout;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DELAY);
    },
    saveNow: flush,
  };
}
