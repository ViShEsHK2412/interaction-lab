/**
 * Which screen, and which file, a thing on the canvas belongs to.
 *
 * Every screen is mounted into one document — that is the whole reason the
 * canvas works, and it is also why a tool that reports `. > div > div > .stage`
 * is telling the truth and saying nothing. On a canvas of ten variants of one
 * file, a path like that fits all ten.
 *
 * The identity is on the screen's root as `data-lab-file`, so anything that can
 * reach an element can name the file it came from. This turns that into an
 * answer, and puts it on `window` so a tool the lab does not control — or a
 * Playwright driver, or a person in the console — can ask.
 */

export interface Where {
  /** The screen's id on the canvas. */
  screen: string;
  /** The file it came from, relative to the folder the lab was pointed at. */
  file: string;
}

/** The screen an element sits in, or null when it is the lab's own chrome. */
export function whereIs(el: Element | null): Where | null {
  if (!el?.closest) return null;

  /*
   * Two ways up, because the obvious one misses in explore mode.
   *
   * Every unfocused frame is covered by a transparent shield so a click
   * selects the frame instead of pressing a button inside a screen you were
   * only looking at. The shield is a sibling of the screen, not an ancestor,
   * so anything landing on it has no `[data-lab-file]` above it at all — and
   * that is most of the canvas most of the time. Falling back to the frame and
   * then down to its screen answers the question that was actually asked.
   */
  const direct = el.closest('[data-lab-file]');
  const root = direct ?? el.closest('[data-screen-id]')?.querySelector('[data-lab-file]') ?? null;
  if (!root) return null;
  return {
    screen: root.getAttribute('data-lab-body') ?? '',
    file: root.getAttribute('data-lab-file') ?? '',
  };
}

/**
 * The screen under a point, in viewport coordinates.
 *
 * For a tool that records where a click landed rather than what it hit. The
 * lab's root is fixed and never scrolls, so a page coordinate and a viewport
 * coordinate are the same number here.
 */
export function whereAt(x: number, y: number): Where | null {
  return whereIs(document.elementFromPoint(x, y));
}

/** Every screen on the canvas, as id to file. */
export function screenFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const root of document.querySelectorAll('[data-lab-file]')) {
    const id = root.getAttribute('data-lab-body');
    if (id) out[id] = root.getAttribute('data-lab-file') ?? '';
  }
  return out;
}

declare global {
  interface Window {
    __labWhere?: {
      is: typeof whereIs;
      at: typeof whereAt;
      files: typeof screenFiles;
    };
  }
}

/** Publish it, so a tool that knows nothing about the lab can still ask. */
export function publishWhere(): void {
  window.__labWhere = { is: whereIs, at: whereAt, files: screenFiles };
}
