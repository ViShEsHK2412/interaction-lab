/**
 * The lab's icons.
 *
 * Lucide geometry, inlined rather than depended on, exactly as align-ui does
 * it and for the same reasons: Lucide is the strictest-ruled set in this space
 * (24x24 box, 2px stroke, round caps and joins, everything on a 1px grid),
 * inlining ten glyphs beats a package dependency, and paths-as-data means an
 * icon is a constant rather than a component tree.
 *
 * Four of these are align-ui's already (`pixels`, `rulers`, `check`, `pick`),
 * copied unchanged so the two tools do not draw the same idea two ways.
 *
 * Lucide is ISC-licensed. Each entry is its icon of that name, unchanged.
 */

const VIEW_BOX = '0 0 24 24';

/** One icon: the `d` of each path, in draw order. `rect` entries are boxes. */
type Shape = { path: string } | { rect: [number, number, number, number, number] };

const p = (path: string): Shape => ({ path });
/** x, y, width, height, radius. Lucide's rects all carry a corner radius. */
const r = (x: number, y: number, w: number, h: number, rx: number): Shape => ({
  rect: [x, y, w, h, rx],
});

export const ICONS = {
  /** grid-3x3 — a lattice, for the pixel texture. align-ui's `pixels`. */
  grid: [r(3, 3, 18, 18, 2), p('M3 9h18'), p('M3 15h18'), p('M9 3v18'), p('M15 3v18')],

  /** ruler-dimension-line — a rule with ticks, and a dimension line above it. */
  rulers: [
    p('M2 8V4'),
    p('M22 8V4'),
    p('M22 6H2'),
    r(2, 12, 20, 8, 2),
    p('M6 15v-3'),
    p('M10 15v-3'),
    p('M14 15v-3'),
    p('M18 15v-3'),
  ],

  /** rotate-ccw — putting the layout back is undoing it, at every scale. */
  reset: [p('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'), p('M3 3v5h5')],

  /** pipette — what every tool calls a colour picker. align-ui's `pick`. */
  colour: [
    p('m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12'),
    p('m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z'),
    p('m2 22 .414-.414'),
  ],

  /**
   * maximize and minimize — four corner brackets pushing out, then pulling in.
   *
   * `play` and a stop square were the first pick and were wrong: fill mode does
   * not start anything, it gives the screen the whole window. Brackets say
   * that, and they say it as a reversible pair, which a play/stop icon does not
   * — stop is the end of something, not the way back.
   */
  maximize: [
    p('M8 3H5a2 2 0 0 0-2 2v3'),
    p('M21 8V5a2 2 0 0 0-2-2h-3'),
    p('M3 16v3a2 2 0 0 0 2 2h3'),
    p('M16 21h3a2 2 0 0 0 2-2v-3'),
  ],
  minimize: [
    p('M8 3v3a2 2 0 0 1-2 2H3'),
    p('M21 8h-3a2 2 0 0 1-2-2V3'),
    p('M3 16h3a2 2 0 0 1 2 2v3'),
    p('M16 21v-3a2 2 0 0 1 2-2h3'),
  ],

  /** scan — brackets around a subject, for framing everything at once. */
  fit: [
    p('M3 7V5a2 2 0 0 1 2-2h2'),
    p('M17 3h2a2 2 0 0 1 2 2v2'),
    p('M21 17v2a2 2 0 0 1-2 2h-2'),
    p('M7 21H5a2 2 0 0 1-2-2v-2'),
  ],

  /**
   * check and triangle-alert — answers, not controls.
   *
   * A toast used to say which kind it was by turning red. That put the one hue
   * the canvas already spends on measurements onto errors as well, and left the
   * meaning carried by colour alone. These carry it instead.
   */
  check: [p('M20 6 9 17l-5-5')],
  warn: [
    p('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'),
    p('M12 9v4'),
    p('M12 17h.01'),
  ],

  /** x — dismiss. */
  close: [p('M18 6 6 18'), p('m6 6 12 12')],
} as const;

export type IconName = keyof typeof ICONS;

/**
 * One icon, inheriting its button's colour.
 *
 * `currentColor` is the whole reason these are inline SVG: an icon has to go
 * quiet when its control is idle and bright when the tool is on, from CSS
 * alone. `aria-hidden` because the control around it carries the name — a
 * screen reader should hear what the button does, not what it looks like.
 *
 * Stroke width follows the text it sits beside: 2 next to semibold, 1.5 next to
 * regular. Everything in the HUD is regular 12px, so 1.5 is the default here.
 */
export function Icon({
  name,
  size = 16,
  strokeWidth = 1.5,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox={VIEW_BOX}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name].map((shape, i) => ('rect' in shape ? (
        <rect
          key={i}
          x={shape.rect[0]}
          y={shape.rect[1]}
          width={shape.rect[2]}
          height={shape.rect[3]}
          rx={shape.rect[4]}
        />
      ) : (
        <path key={i} d={shape.path} />
      )))}
    </svg>
  );
}
