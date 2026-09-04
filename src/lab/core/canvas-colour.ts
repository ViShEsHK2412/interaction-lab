/**
 * The canvas colour, and the swatches you have saved.
 *
 * Hex-first, and no preset swatches: a preset row is somebody else's taste
 * taking up the space your own would. The row fills with colours you actually
 * chose, which after a day of use is a better palette than any default.
 */

const COLOUR_KEY = 'interaction-lab:canvas:v1';
const SWATCH_KEY = 'interaction-lab:swatches:v1';

export const DEFAULT_CANVAS = '#f1f1f1';
/** Enough to be useful, few enough to stay one row. */
export const MAX_SWATCHES = 10;

/**
 * Accepts three or six digits with or without the hash, and normalises to
 * lowercase six with one. Typing `fff` should work, because that is what
 * people type.
 */
export function normaliseHex(value: string): string | null {
  const trimmed = value.trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) return null;
  const full = trimmed.length === 3
    ? trimmed.split('').map((c) => c + c).join('')
    : trimmed;
  return `#${full.toLowerCase()}`;
}

/** Newest first, deduped, capped. Saving one you already have just moves it up. */
export function addSwatch(existing: readonly string[], colour: string): string[] {
  const hex = normaliseHex(colour);
  if (!hex) return [...existing];
  return [hex, ...existing.filter((c) => c !== hex)].slice(0, MAX_SWATCHES);
}

export function loadColour(): string {
  try {
    return normaliseHex(localStorage.getItem(COLOUR_KEY) ?? '') ?? DEFAULT_CANVAS;
  } catch {
    return DEFAULT_CANVAS;
  }
}

export function saveColour(colour: string): void {
  const hex = normaliseHex(colour);
  if (!hex) return;
  try { localStorage.setItem(COLOUR_KEY, hex); } catch { /* disabled */ }
}

export function loadSwatches(): string[] {
  try {
    const raw = localStorage.getItem(SWATCH_KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    // Every entry re-validated: this is text from a previous version.
    const out: string[] = [];
    for (const item of data) {
      const hex = typeof item === 'string' ? normaliseHex(item) : null;
      if (hex && !out.includes(hex)) out.push(hex);
    }
    return out.slice(0, MAX_SWATCHES);
  } catch {
    return [];
  }
}

export function saveSwatches(swatches: readonly string[]): void {
  try { localStorage.setItem(SWATCH_KEY, JSON.stringify(swatches)); } catch { /* disabled */ }
}
