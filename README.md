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
- `Ctrl/Cmd + Z` undo, `Shift` to redo, one entry per completed gesture. A run
  of arrow nudges collapses into a single step
- Camera and layout saved to `localStorage`, with a reset in the HUD. Undo
  lives in `sessionStorage`, so it survives a reload and dies with the tab
- Frames cull offscreen without unmounting, so screen state survives

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

Undo, rulers and guides, Alt-hover distance measurement, and the dev-server
file operations that make duplicate and delete real.

## Development

```bash
npm install
npm run dev        # http://localhost:5190
npm test           # the pure maths
npm run typecheck
```
