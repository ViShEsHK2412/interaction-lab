# interaction-lab

A Figma-style infinite canvas that hosts your app screens, fully interactive.

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
  content at every zoom. Frames snap to guides as readily as to each other
- A pixel grid that fades out rather than turning into a wash
- Hold `Alt` with one frame selected and hover another for the distances
  between them, Figma-style
- `Ctrl/Cmd + Z` undo, `Shift` to redo, one entry per completed gesture. A run
  of arrow nudges collapses into a single step
- `Ctrl C` tidies every frame into an evenly spaced row
- `Cmd/Ctrl D` duplicates a screen and `Delete` removes it, both as **real file
  operations**, with `Ctrl/Cmd Z` restoring a deleted one from `.lab-trash`
- Camera and layout saved to `localStorage`, with a reset in the HUD. Undo
  lives in `sessionStorage`, so it survives a reload and dies with the tab
- Frames cull offscreen without unmounting, so screen state survives

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
`.lab-trash`; `Ctrl/Cmd Z` moves it back. `Alt` + double-click on a label
renames it, writing the manifest. Everything is persisted before the request,
so the reload each one triggers can land whenever it likes.

The plugin is `apply: 'serve'`, so none of it exists in a production build. The
client treats a failed request as "the file half did not happen", and the
canvas carries on.

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

Two-pointer touch pinch is there but lightly tested. Alt-drag to duplicate with
a ghost, and a toast system for the file operations, are the two pieces of the
original prompt not built here.

## Development

```bash
npm install
npm run dev        # http://localhost:5190
npm test           # the pure maths
npm run typecheck
```
