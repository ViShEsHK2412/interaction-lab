/**
 * Design tokens, ported from align-ui.
 *
 * Same system, same reasoning: a **film of alpha over an opaque ground**. The
 * ground is one colour, and every surface above it is white at a measured
 * alpha, so a nested region separates from its parent without anyone picking a
 * second grey. Text works the same way, at three levels.
 *
 * One half of align-ui's system deliberately does not come across. There, the
 * panels answer `light-dark()`, because they float over a page whose theme they
 * cannot choose. Here the chrome floats over a canvas whose colour *the user
 * sets*, and a HUD that flipped to light on a light canvas would lose the
 * separation from it that is the only reason it reads as chrome at all. So the
 * ground is fixed dark, and the two things that genuinely sit on the canvas —
 * the frame label and the ruler ink — pick their own contrast at runtime
 * instead. Inheriting a system means inheriting its reasoning, not its list.
 *
 * Every number below was measured rather than chosen. The measurements are in
 * the comments, and `theme.test.ts` recomputes them so they cannot rot.
 */

/* ── Ground and surfaces ──────────────────────────────────────────────────── */

/** What all chrome sits on. align-ui's ground, so its measurements transfer. */
export const GROUND = '#1a1a1a';

/**
 * The surface ladder. Index 0 is the ground; each step up is one region nearer
 * the viewer. align-ui's alphas, unchanged.
 */
export const LADDER = [0, 0.07, 0.08, 0.1, 0.12, 0.15, 0.2] as const;

/* ── Ink that lands on the canvas ─────────────────────────────────────────── */

/**
 * Two steps of one hue, and the split is the whole point.
 *
 * `line` is the stroke: selection rings, resize handles, the duplicate ghost.
 * A stroke is a graphic and needs 3:1, but it lands on a canvas colour the user
 * chose, so it also carries a casing (see `--casing` in theme.css) rather than
 * trusting the hue alone.
 *
 * `solid` is the fill behind white text: the size badge, the selected label's
 * chip, the play button. White on `#0d99ff` measures **2.99:1** and fails 4.5:1
 * outright, which is why the two cannot be one token. White on `#0a6dc0` is
 * **5.30:1**, and it still reads unmistakably as the same blue.
 */
export const ACCENT = {
  line: '#0d99ff',
  solid: '#0a6dc0',
} as const;

/**
 * Measurement red, split the same way and for the same measured reason.
 *
 * `line` is Figma's, and it stays Figma's: every user of a canvas tool arrives
 * already knowing that the red dashes are a distance. `chip` is the filled
 * label — white on `#f24822` is **3.67:1**, white on `#c33513` is **5.47:1**.
 */
export const MEASURE = {
  line: '#f24822',
  chip: '#c33513',
} as const;

/**
 * Red means *measurement* in this tool, on the canvas, permanently. So it is
 * not also what an error looks like: a warning toast keeps the ordinary dark
 * surface and says what it is with an icon, which is the redundant cue an error
 * needs anyway. One colour, one meaning, and nothing important carried by hue.
 */
export const DANGER = '#e5533d';

/* ── Spacing ──────────────────────────────────────────────────────────────── */

/**
 * align-ui's scale, and the one thing here that has to be obeyed rather than
 * admired. Before this the chrome ran on 2, 5, 6, 7, 9, 10, 14 and 26.
 */
export const SPACE = {
  /** Between a label and the thing it labels. */
  tight: 4,
  /** The default gap, and every region's padding. */
  base: 8,
  /** Inside a cell that has to look like a box of its own. */
  roomy: 12,
  /** Between a floating surface and the edge of the window. */
  edge: 16,
} as const;

/** One control height, so the HUD and the popover share a rhythm. */
export const CONTROL = 28;

/* ── Type ─────────────────────────────────────────────────────────────────── */

export const FONT_STACK =
  'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, '
  + '"Helvetica Neue", Arial, sans-serif';

/**
 * Named by use. align-ui stops at 11px on the grounds that a measuring tool
 * whose numbers are hard to read has failed at its only job; a canvas tool is
 * the same tool. The play button was drawing a 9px glyph before this, which is
 * both below that floor and the reason it is now a real icon instead.
 */
export const TYPE = {
  title: 13,
  body: 12,
  tag: 11,
} as const;

/* ── Motion ───────────────────────────────────────────────────────────────── */

/**
 * Two curves, align-ui's, and no third.
 *
 * `ui` is critically damped: no overshoot, because nothing here is opened by a
 * gesture that carried momentum into it. `exit` starts where it is and
 * accelerates away, because an exit is not an entrance played backwards — the
 * user has already decided, and the job is to get out of the way.
 *
 * 160ms sits inside the 120–180ms band for anything you press and under the
 * 300ms ceiling for anything you trigger. Nothing that repeats at keyboard
 * frequency animates at all, which is a rule the camera and the mode switches
 * already keep.
 */
export const MOTION = {
  ui: '160ms cubic-bezier(0.2, 0, 0, 1)',
  exit: '160ms cubic-bezier(0.3, 0, 1, 1)',
} as const;

/** How long a toast's exit runs, in ms. Must match `MOTION.exit`. */
export const EXIT_MS = 160;
