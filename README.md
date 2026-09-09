# interaction-lab

A Figma-style infinite canvas that hosts your app screens, fully interactive.
Screens are React components or plain HTML files.

Zoom out to see every prototype at once. Pan around. Double-click a screen to
lock in and use it like the real app.

Built from [timothymaarv/interaction-lab-prompt](https://github.com/timothymaarv/interaction-lab-prompt),
adapted: the prompt assumes an existing app to convert, and this is the lab on
its own, with demo screens instead.

No dependencies beyond React. The camera, the input routing and the persistence
are all hand-rolled, which is the point: a canvas is about a hundred lines of
arithmetic and you want to own them.

## What works

- An infinite canvas as the app shell, with two demo screens on it
- Pan by wheel, by dragging empty canvas, by space-drag or middle-drag
- Zoom to the cursor by `Ctrl`/`Cmd`+wheel or trackpad pinch, anchored so the
  point under the pointer never moves
- Click to select, drag to move, double-click to lock in and use the screen for
  real, `Esc` to come back out
- `Shift 1` fit all, `Shift 2` fit selected, `Shift 0` 100%, `+`/`-` zoom steps,
  `Tab` to cycle, arrows to nudge (`Shift` for 10)
- Resize a selected frame from any of its eight handles, with a live size badge
- Snapping: edges and centres onto other frames, with red alignment lines, plus
  whole-pixel rounding on any axis the geometry did not claim. `Ctrl`/`Cmd`
  held mid-drag bypasses it
- Three modes: explore, focus (`double-click`), fill (`Shift F`). `Esc` walks
  back one at a time, and a screen gets first refusal on it
- Rulers and guides (`Shift R`) in page units, so they stay glued to the
  content at every zoom. Frames snap to guides as readily as to each other.
  `Ctrl/Cmd Shift R` takes the rules away and leaves the guides, which still
  drag, still snap, and still delete
- A pixel grid that fades out rather than turning into a wash
- The canvas colour is yours: a picker, a hex field that takes any of the four
  spellings people paste, and a swatch row of the ones you saved
- Hold `Alt` with one frame selected and hover another for the distances
  between them, Figma-style
- `Ctrl/Cmd + Z` undo, `Shift` to redo, one entry per completed gesture. A run
  of arrow nudges collapses into a single step
- `Ctrl C` tidies every frame into an evenly spaced row
- `Cmd/Ctrl D` duplicates a screen and `Delete` removes it, both as **real file
  operations**, with `Ctrl/Cmd Z` restoring a deleted one from `.lab-trash`.
  `Alt`-dragging a frame duplicates it where you drop it, with a ghost showing
  where that is
- Every file operation says what happened, including when it failed, because a
  silent failure is indistinguishable from a broken feature
- Camera and layout saved to `localStorage`, with a reset in the HUD. Undo
  lives in `sessionStorage`, so it survives a reload and dies with the tab
- Frames cull offscreen without unmounting, so screen state survives
- `Ctrl/Cmd Shift Backspace` puts the layout back where it started

## How the chrome is built

The lab's own surfaces run on align-ui's design system: one dark ground with
every surface above it a film of white alpha, three text levels, a four-step
spacing scale, and two motion curves. `theme.css` holds the tokens and
`theme.ts` the same system for the code that paints canvas.

Colours are split into a line step and a solid step, and the split is measured
rather than stylistic. White on `#0d99ff` is 2.99:1, so the accent that draws a
selection ring cannot also be the fill behind a badge's white text. `theme.test.ts`
recomputes every ratio the comments claim, so none of them can quietly rot.

Icons are Lucide geometry inlined, not a dependency. Inter is self-hosted as a
single variable woff2, which covers 400 to 600 with nothing synthesised.

## Screens are folders

A folder under `src/screens` with a `screen.ts` in it is a screen. There is no
list to keep in step:

```ts
// src/screens/feed/screen.ts
import type { ScreenManifest } from '../../lab/screen-manifest';
import { FeedScreen } from './feed-screen';

const manifest: ScreenManifest = {
  id: 'feed',                       // optional; the folder name otherwise
  name: 'Feed',
  width: 1440,
  height: 900,
  position: { x: 0, y: 0 },
  component: FeedScreen,
};

export default manifest;
```

That is what lets duplicate and delete be real. `Cmd/Ctrl D` asks the dev
server to copy the folder and patches the copy's manifest; `Delete` moves it to
`.lab-trash`; `Ctrl/Cmd Z` moves it back. Double-clicking a label
renames it, writing the manifest. Everything is persisted before the request,
so the reload each one triggers can land whenever it likes.

The plugin is `apply: 'serve'`, so none of it exists in a production build. The
client treats a failed request as "the file half did not happen", and the
canvas carries on.

## HTML screens

A screen does not have to be React. Drop a `.html` file into a folder under
`src/screens` and it is a screen:

```
src/screens/
  html-hello/index.html          → one screen
  html-variants/soft.html        → three screens, one per file
                sharp.html
                loud.html
```

No manifest, no imports, no build step. A folder holding several pages puts
one frame on the canvas per file, which is the whole reason to want this: ten
variants side by side instead of ten files opened one at a time. A `screen.ts`
can still name one explicitly, with `src` in place of `component`:

```ts
const manifest: ScreenManifest = {
  name: 'Pricing v3',
  width: 1440, height: 900,
  position: { x: 0, y: 0 },
  src: './index.html',
};
```

**Mounted into the lab's own document, not an iframe.** That is the decision
everything else follows from. A measuring or annotating tool works on one
document, so an iframe boundary would make it impossible to measure *between*
two screens, which is the one comparison a canvas exists to make. It also
means `document.getElementById` inside the file keeps working, which is how
every hand-written prototype finds its own elements.

The cost is that a file's CSS would otherwise restyle the lab and every screen
beside it, so each stylesheet is rewritten to sit under the screen's own root.
`:root`, `html` and `body` become that root — a prototype declares its tokens
on `:root`, and they have to land somewhere — and everything else is nested
under it. `scopeCss` does this and `html-screens.test.ts` holds it to the
awkward cases: braces inside strings and comments, `@keyframes` steps that
must not be touched, `@supports` inside `@media`, and unterminated everything.

Setting `isolate: true` in a manifest mounts behind a shadow root instead.
That is stronger isolation, and it cuts the file's scripts off from
`document`, so it is the exception rather than the default.

### The contract, for a file

`useScreen()` is a React hook and a `.html` file cannot call one, so the same
facts arrive on the screen's root element, where plain CSS and three lines of
vanilla JS can both reach them:

| | |
|---|---|
| `data-active` | `"true"` while locked in |
| `data-visible` | `"false"` when culled offscreen |
| `--frame-width`, `--frame-height` | the frame's size, in page units |
| `lab:escape` event | cancel it to keep Escape; the lab exits otherwise |
| `lab:unmount` event | the screen is going away: stop your timers, loops and observers |
| `window.__labScreens[id]` | every mounted screen's root, for a test driver |

A file's own images, fonts, stylesheets and scripts resolve against the folder
it came from, not against the lab: `./card.png` beside the file still means
beside the file. The one thing that cannot be fixed from out here is a URL the
screen's own JavaScript builds at runtime — `fetch('./data.json')` resolves
against the page, and the page is the lab. Ask for it relative to
`import.meta.url`, or give it an absolute path.

Removing a script does not stop what it started, so a screen that runs a loop,
an interval or an observer has to stop it on `lab:unmount`. Nothing else can:
the lab cannot reach inside a script it executed. A screen that ignores this
keeps running against a detached tree after it is replaced — and every mount is
torn down and rebuilt once in development, so it happens immediately rather
than rarely.

`window.__lab` is deliberately left alone: a prototype that instruments itself
for a Playwright driver almost always claims that name for its own readouts,
and taking it would break the file the moment it was hosted.

**The hard cases screen** (`src/screens/html-hard-cases`) runs all of this
live and shows a pass/fail tally, including what each of the four in-page
tools needs — hit-testing that reaches into a screen, a selector that
round-trips through `querySelector`, computed styles that read back, an inline
style that applies and reverts, and an animation there to freeze.

### Screens are still folders

File operations target folders, so a screen that shares its folder with other
variants cannot be duplicated, deleted or renamed — the lab says so rather
than taking the other nine files with it.

## Any folder, on the canvas

```bash
npm run lab -- ../work/Experiments/chapter-card-lab
```

Every page in that folder becomes a frame, and every page one level down as
well. Ten variants that could only ever be opened one at a time are suddenly
side by side, which is the entire reason to want a canvas instead of a folder.

Nothing is copied and nothing is written. The folder is read, its files are
served in place, and editing one of them hot-reloads that frame where it sits.
Duplicate, delete and rename stay off: they are the lab's own screens only, and
the lab will not touch work that lives somewhere else.

A glob has to be a literal, so a folder chosen at startup cannot be one —
`vite-plugin-lab-screens` scans it and writes the module the registry imports.
It also has to name the project's own directory in `server.fs.allow` alongside
the target: setting that from a plugin replaces the default rather than adding
to it, and the default is what lets Vite serve the lab at all.

## From nothing, in one command

`scripts/setup-lab.mjs` is self-contained on purpose: copy it anywhere, hand it
to an agent, point it at a folder. It needs `git` and `node` and nothing else.

```bash
node setup-lab.mjs ./Experiments/chapter-card-lab
```

It clones or updates the lab, installs the latest of every tool, and opens that
folder on the canvas with all of them over it. Everything is fetched fresh each
run — agentation moves quickly, align-ui and the lab are yours and move faster,
and a rig that pins whatever it first saw is a rig that goes stale without
saying so.

```
--lab <path>   where to keep the lab   (default ~/.interaction-lab)
--port <n>     dev server port         (default 5190)
--no-open      set up, do not start
--no-tools     just the canvas
```

The folder is only ever read. Nothing is copied into it and nothing is written
to it, and the lab refuses to duplicate, delete or rename anything outside its
own project.

## The tools

```bash
npm run lab:tools           # install and mount
npm run lab:tools -- --off  # unmount, keep the packages
```

agentation and dialkit mount **once, for the whole canvas** — each works on a
document, and this is one document, which is what makes measuring *between* two
frames possible at all. Per screen they would be three toolbars fighting over
one click.

interface-kit is deliberately not here. Its panel renders its own shadow
controls outside itself, and there is no sense wiring up something visibly
broken — it sits in its own shadow root outside the lab, so that was never the
lab's to fix. Put it back by adding it to `TOOLS` in `scripts/lab-tools.mjs`.

It writes `src/lab/tools/enabled.tsx`, which is generated and out of git. That
file is the switch; the mount finds it with a glob rather than an import,
because a glob that matches nothing is an empty object while an import of a
file that is not there is a build error.

align-ui comes with them, and needs no config edit either. It is a Vite plugin
rather than a component, so it has to be named in `vite.config.ts` — but a
config that imports a package the project may not have will not load at all, so
the lab would refuse to start until you had installed a measuring tool you never
asked for. `vite-plugin-lab-tools.ts` resolves it at startup instead: installed,
it is on (`Ctrl/Cmd + Shift + A`); absent, it is an empty array. Restart the dev
server after installing, since plugins are read once.

dialkit is installed and its `DialRoot` is mounted, which is all it needs from
here — it works on values you declare yourself with `useDialKit`, so it shows
nothing until you have declared one.

Two things the HUD will remind you of. **One inspector armed at a time** —
align-ui and agentation both want the same hover and the same click. And
**measure at 100%** (`Shift 0`): both read `getBoundingClientRect`, the canvas
scales the page, and at 81% every size and distance comes back at 81% of the
truth. The HUD says so whenever the tools are mounted and the camera is not at
100%.

## The screen contract

A screen renders inside a frame that an ancestor is translating and scaling,
which makes every normal instinct about coordinates wrong. `useScreen()` is how
a screen gets the answers it actually needs:

```tsx
const { active, visible, frameSize, clientToFrame, setEscapeInterceptor } = useScreen();
```

- Pointer positions come from `clientToFrame`, never from `clientX` directly
- Sizes come from `frameSize`, never from `window.innerWidth`
- Anything expensive stops when `visible` is false
- Global shortcuts gate on `active`
- `setEscapeInterceptor` claims `Esc` when the screen has something to close

## The hard cases

The third screen, **The hard cases**, is the one to open when changing
anything. Every section states what the right answer is, so you can check
rather than remember:

1. What the lab tells the screen, and what changes when
2. Pointer coordinates, showing the contract's answer next to the raw window
   one so the wrong number is visible as wrong
3. A drag that must stay under the pointer at 25% and at 200%
4. The frame's own scroll, next to `window.scrollY`, which is always 0
5. A shortcut that only fires while the screen is locked into
6. A frame loop that must freeze when culled, unfocused or backgrounded
7. Escape arbitration: the dialog gets it first, the lab gets it second
8. Long content, so culling has something to keep mounted

## Still to build

Two-pointer touch pinch is written but only lightly tested, since verifying it
honestly needs a real touchscreen rather than emulated events.

## Development

```bash
npm install
npm run dev        # http://localhost:5190
npm test           # the pure maths
npm run typecheck
```
