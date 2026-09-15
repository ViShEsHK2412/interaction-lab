# Runbook

For whoever — or whatever — is setting this up against a folder of prototypes.
Read the first two sections before running anything; the rest is why.

## Run it

```bash
node setup-lab.mjs <folder>
```

One command, from nothing. It clones or updates the lab into `~/.interaction-lab`,
installs the latest align-ui, agentation and dialkit, and opens every `.html`
in that folder — and one level down — on a single canvas.

```
--lab <path>   where to keep the lab   (default ~/.interaction-lab)
--port <n>     dev server port         (default 5190)
--no-open      set up, do not start
--no-tools     canvas only, no overlays
```

Needs `git` and `node`. Nothing else, and nothing to configure.

**The folder is only ever read.** Nothing is copied into it, nothing is written
to it, and duplicate/delete/rename refuse on anything outside the lab's own
project.

Two constraints that are not obvious:

- **Keep the lab on a normal path.** Windows temp directories carry 8.3 short
  names (`VISHES~1`), and Vite checks its serving allow list by resolved path
  while leaving the request as its root produced it, so a short-named directory
  refuses files it visibly contains. `~/.interaction-lab` is fine; `%TEMP%` is
  not.
- **Restart the server after installing tools.** align-ui is a Vite plugin, and
  plugins are read once at startup.

## Check it worked — and how to check anything here

**Never verify this with a screenshot.** A thumbnail at 20% zoom cannot tell a
styled page from a white page with text on it, and that is the exact failure
this codebase produces. Ask the DOM a question with a real answer:

```js
// Did that screen's CSS actually apply?
getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)'

// Which file is this element from? Works whether or not any tool is installed.
window.__labWhere.is(el)      // → { screen: 'card-elite', file: 'card-elite.html' }
window.__labWhere.files()     // → every screen on the canvas, id to file
```

The lab ships a screen that checks itself: open **HTML hard cases** on the
canvas and press *Re-run checks*. Eighteen assertions about the contract, each
stating what the right answer is. If something is wrong with the lab rather
than with your file, it usually shows there first.

**Do not trust an HTTP 200 from a dev server.** Vite answers unknown paths with
the SPA shell, so a missing file returns 200 with HTML in it. Check the
content-type, or that the body does not start with `<!doctype html>`.

## Why things kept breaking

One cause, many faces.

**The lab makes one document pretend to be many.** Screens are mounted into the
lab's own page rather than into iframes — deliberately, because that is what
lets one measuring pass reach across two frames and one annotation session
cover ten variants. An iframe per screen would take that away, and it is the
only reason the canvas is worth more than a folder of browser tabs.

The cost is that every file believes it is the whole document, and that belief
is true only for the things the lab has explicitly emulated. Each bug was one
more thing nobody had thought to emulate yet:

| A file expects | What it got | Fixed by |
|---|---|---|
| its own ids | one id space shared by ten variants | a scoped `document` |
| its own `@keyframes` | one global name | per-screen renaming |
| `:root` to mean itself | the lab's root | rewriting the selector |
| `[data-theme]` to mean itself | a descendant that never exists | folding attribute and class heads |
| `documentElement` to be itself | the lab's `<html>` | mapping it to the screen root |
| `DOMContentLoaded` to fire | `readyState: complete`, event long gone | a per-screen lifecycle |
| `./card.png` to be beside it | the lab's origin | resolving against the file's folder |
| `<link>` treated like `<style>` | appended raw, unscoped | reading and scoping it |

**Every failure in this class is silent.** That is what made them expensive,
and it is structural rather than bad luck:

- An unstyled page is a valid page. The browser has no opinion.
- A stylesheet served with the wrong content type is dropped without an error.
- An event that never fires raises nothing.
- A relative URL that is not rebased still resolves — just somewhere else.
- A dev server with an SPA fallback answers 200 for a file that is not there.

So the signature to watch for is **unstyled but functional**: the page clicks,
toggles and types correctly while rendering like a 1995 web page. Scripts are
hoisted and run; only the emulation of *being a document* failed.

**And the reason they were found by you rather than by the tests:** every check
in this repo used the lab's own built-in screens, which have an absolute base,
no linked stylesheets and no theme toggles. The rig was testing the easy case
and calling it covered. The URL-resolution bug survived a test written
specifically for URL resolution, because that test used a built-in screen.

If you change anything in `html-screen.tsx` or `html-screens.ts`, **verify it
against a folder outside the project.** That is the case that breaks.

## What is still true, and worth knowing

- **One inspector armed at a time.** align-ui and agentation both want the same
  hover and the same click.
- **Measure at 100%** (`Shift 0`). The canvas scales the page, so anything
  reading `getBoundingClientRect` at 81% zoom reports 81% of the truth. The HUD
  says so when tools are mounted and the camera is not at 100%.
- **A file using inline `on*` handlers keeps the global scope.** Wrapping its
  scripts would put those handlers out of reach, so it opts out of id scoping
  and `getElementById` finds whichever screen mounted first. The console names
  the screen when this happens.
- **`window.__lab` is yours.** The lab uses `__labScreens` and `__labWhere`, so
  a prototype instrumented for a Playwright driver keeps its own readouts.
- **A folder can ask for a shadow root** with `lab.json` beside its pages:
  `{ "isolate": true }`. Stronger isolation, at the cost of cutting the file's
  scripts off from `document.getElementById`. Light DOM is the default for that
  reason.

## Writing a prototype that behaves

Almost nothing is required any more — most of the old rules became bugs and
were fixed at the source. What remains:

- Prefer `addEventListener` to `onclick=` in markup, so the file keeps its own
  id space on a canvas of variants.
- `fetch('./data.json')` inside a screen's own script resolves against the
  page, and the page is the lab. Build the URL from `import.meta.url`, or use
  an absolute path.
- A script that runs before its markup exists should retry rather than assume —
  `if (!root) return requestAnimationFrame(start)`. Module scripts are async
  and `document.currentScript` is `null` in them.
