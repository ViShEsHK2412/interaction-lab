import { useEffect, useRef } from 'react';
import { useScreen } from '../screen-context';
import {
  BODY_ATTR, cssSuffix, parseHtmlDocument, renameKeyframes, resolveAssetUrl, rewriteCssUrls,
  scopeCss, scopeFor, usesInlineHandlers, wrapScript,
} from './html-screens';

/**
 * The lab's registry of mounted HTML screens, on `window`.
 *
 * Deliberately not `window.__lab`: a prototype that instruments itself for a
 * Playwright driver almost always claims that name for its own readouts, and
 * taking it would break the file the moment it was hosted. This is a separate
 * name holding each screen's root element, so a driver can scope its queries
 * to one screen and read whatever the file itself exposes.
 */
declare global {
  interface Window {
    __labScreens?: Record<string, HTMLElement>;
    __labScope?: (screenId: string) => Document;
  }
}

/**
 * `document`, as one screen sees it.
 *
 * Element ids are unique within a file and emphatically not across a canvas of
 * ten variants of that file, so the four lookups that search the whole document
 * are re-pointed at the screen's own root. Everything else falls through to the
 * real document, bound to it, so `createElement`, `body` and `currentScript`
 * are untouched.
 */
interface ScreenLifecycle {
  /** False until this screen's own scripts have finished running. */
  ready: boolean;
  /** Listeners waiting for a DOMContentLoaded that already happened. */
  waiting: { type: string; fn: EventListenerOrEventListenerObject }[];
}

function scopedDocument(root: HTMLElement, life: ScreenLifecycle): Document {
  return new Proxy(document, {
    get(target, prop) {
      switch (prop) {
        case 'getElementById':
          return (id: string) => root.querySelector(`[id="${CSS.escape(id)}"]`);
        case 'querySelector':
          return (sel: string) => root.querySelector(sel);
        case 'querySelectorAll':
          return (sel: string) => root.querySelectorAll(sel);
        case 'getElementsByClassName':
          return (cls: string) => root.getElementsByClassName(cls);
        case 'getElementsByTagName':
          return (tag: string) => root.getElementsByTagName(tag);

        /*
         * The root of the document, as this screen means it.
         *
         * A prototype toggles a theme with
         * `document.documentElement.dataset.theme = 'dark'`. Falling through,
         * that writes to the lab's own `<html>` — one screen restyles the host
         * and every sibling on the canvas, and its own themed rules still do
         * not match, because they were scoped to this screen. Both halves of
         * the same failure. `body` goes the same way for the same reason.
         */
        case 'documentElement':
        case 'body':
          return root;

        /*
         * Still loading, until this screen's scripts have run.
         *
         * They are appended long after the host document finished, so the
         * truthful answer is 'complete' and the consequence is that
         * `DOMContentLoaded` has already been and gone. The single commonest
         * line in any prototype — `document.addEventListener('DOMContentLoaded',
         * init)` — then never runs, and the file looks dead with no error.
         */
        case 'readyState':
          return life.ready ? 'complete' : 'loading';

        case 'addEventListener':
          return (
            type: string,
            fn: EventListenerOrEventListenerObject,
            opts?: boolean | AddEventListenerOptions,
          ) => {
            if ((type === 'DOMContentLoaded' || type === 'readystatechange') && !life.ready) {
              life.waiting.push({ type, fn });
              return;
            }
            document.addEventListener(type, fn, opts);
          };

        default: {
          const value = Reflect.get(target, prop) as unknown;
          return typeof value === 'function'
            ? (value as (...a: unknown[]) => unknown).bind(target)
            : value;
        }
      }
    },
  }) as Document;
}

/**
 * Tell a screen the page is ready, once its own scripts have run.
 *
 * Fired on the screen's root rather than the document, so one screen becoming
 * ready is not an event every other screen's listeners can see.
 */
function announceReady(root: HTMLElement, life: ScreenLifecycle): void {
  if (life.ready) return;
  life.ready = true;
  const waiting = life.waiting.splice(0);
  for (const { type, fn } of waiting) {
    const event = new Event(type === 'readystatechange' ? 'readystatechange' : 'DOMContentLoaded');
    try {
      if (typeof fn === 'function') fn.call(root, event);
      else fn.handleEvent(event);
    } catch (error) {
      console.error('[lab] a screen threw while handling DOMContentLoaded', error);
    }
  }
}

/** Per-screen readiness, looked up by id when a script asks through the proxy. */
const lifecycles = new Map<string, ScreenLifecycle>();

/** Whether a URL is ours to read, so its text can be scoped rather than linked. */
function sameOrigin(url: string): boolean {
  try {
    return new URL(url, document.baseURI).origin === location.origin;
  } catch {
    return false;
  }
}

export interface HtmlScreenProps {
  screenId: string;
  html: string;
  /** The file this screen is, relative to wherever the lab was pointed. */
  file: string;
  /** The folder the file came from, so its own assets still resolve. */
  base: string;
  /** Mount behind a shadow root instead of scoping the CSS. Off by default. */
  isolate: boolean;
}

/**
 * An HTML file, mounted into the lab's own document.
 *
 * Not an iframe, and the reason is the whole point of the canvas: overlays
 * like a measuring tool or an annotator are per-document, so a frame boundary
 * would make it impossible to measure between two screens — the one comparison
 * a canvas exists to make. One document keeps every screen reachable by one
 * pass of one tool.
 */
export function HtmlScreen({ screenId, html, file, base, isolate }: HtmlScreenProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { active, visible, frameSize, setEscapeInterceptor } = useScreen();

  /**
   * Mount, keyed on the source.
   *
   * Vite's HMR replaces the raw text on save, so editing the `.html` file
   * re-runs exactly this and nothing else: the frame, the camera and the
   * screen's place on the canvas all survive the edit.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const parsed = parseHtmlDocument(html, document, base);
    const root: HTMLElement | ShadowRoot = isolate
      ? (host.shadowRoot ?? host.attachShadow({ mode: 'open' }))
      : host;

    root.textContent = '';

    /*
     * An isolated screen says who it is from outside its own shadow.
     *
     * The identity attributes go on the screen root, and under `isolate` that
     * root is inside a shadow tree - where `document.querySelectorAll` cannot
     * reach it. So the one screen that most needs naming was the one screen
     * missing from `__labWhere.files()`, and an annotation taken on it came
     * back with no file at all. The host is in the light DOM and carries the
     * same two attributes, which costs nothing: the shadow's own rules are
     * scoped inside it and never match the host.
     */
    if (isolate) {
      host.setAttribute(BODY_ATTR, screenId);
      host.setAttribute('data-lab-file', file);
    }

    // The screen's own root. Every rule in the file is rewritten to sit under
    // this, and the file's `<body class>` lands on it, so a prototype that
    // themes itself with a body class still themes itself.
    const body = document.createElement('div');
    // The id, not an empty marker: every screen carries this attribute, so a
    // stylesheet scoped to the bare attribute is scoped to every screen at
    // once and the last one mounted wins every token.
    body.setAttribute(BODY_ATTR, screenId);
    /*
     * The file, on the element.
     *
     * Every screen is in one document, so a tool that annotates an element
     * reports a path like `. > div > div > .stage` — true, and useless on a
     * canvas of ten variants of the same file. The identity has to be *in* the
     * DOM for anything to find it without the lab's cooperation.
     */
    body.setAttribute('data-lab-file', file);
    /*
     * Fill the frame.
     *
     * A file's `body { background }` becomes a rule on this element, and a
     * plain div is only as tall as its text, so the background painted a band
     * across the top and the frame showed through below it. The host is a
     * column flex box of definite height and this grows to fill it, which also
     * gives the file's own `height: 100%` a parent to resolve against.
     */
    body.style.flex = '1 0 auto';
    body.style.minHeight = '100%';
    if (parsed.bodyClass) body.className = parsed.bodyClass;

    for (const sheet of parsed.styles) {
      if (sheet.kind === 'text') {
        const style = document.createElement('style');
        /*
         * Scoped even inside a shadow root, which is not belt and braces.
         *
         * An isolated screen used to take its CSS verbatim, on the reasoning
         * that a shadow root already keeps it in. It does - but the file's
         * rules are written against a document, and a shadow root has no
         * `body` and no `:root` for `body { background }` to land on. The
         * screen came up correct and completely unstyled, which is this
         * codebase's signature failure. The scoper rewrites exactly those
         * heads onto the screen's own root, so it is needed here most.
         */
        style.textContent = renameKeyframes(
          scopeCss(sheet.value, scopeFor(screenId)),
          cssSuffix(screenId),
        );
        root.appendChild(style);
      } else {
        const href = resolveAssetUrl(sheet.value, base);
        /*
         * A linked sheet gets the same treatment as an inline one.
         *
         * It used to be appended as a `<link>` and left alone, which meant a
         * `tokens.css` declaring `:root { --bg }` landed on the lab's own root
         * and every screen beside it — and two variants linking different
         * sheets simply overwrote each other. Everything the scoper exists to
         * prevent, reintroduced by the tag it did not cover.
         *
         * Same-origin only. A font from a CDN has nothing to scope and cannot
         * be read cross-origin anyway, so it stays a plain `<link>`.
         */
        if (!sameOrigin(href)) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = href;
          root.appendChild(link);
        } else {
          const style = document.createElement('style');
          style.dataset['from'] = href;
          root.appendChild(style);
          /*
           * Ask for CSS, and check that CSS is what came back.
           *
           * A dev server can answer the same URL two ways depending on who is
           * asking: Vite hands a `<link>` real CSS and hands `fetch` a
           * JavaScript module that injects the styles itself, because the
           * Accept header differs. Fetching without saying so scopes a module
           * as though it were a stylesheet — no error, no styles, and a
           * `<style>` full of JavaScript to find later.
           *
           * So the header is explicit, and the answer is checked. Anything
           * that is not CSS falls back to the plain `<link>` the browser knows
           * how to ask for, unscoped but working.
           */
          void fetch(href, { headers: { Accept: 'text/css,*/*;q=0.1' } })
            .then(async (res) => {
              if (!res.ok) throw new Error(`${res.status}`);
              const type = res.headers.get('content-type') ?? '';
              if (!/text\/css/i.test(type)) throw new Error(`served as ${type || 'no type'}`);
              return res.text();
            })
            .then((text) => {
              // The mount may have been torn down while this was in flight.
              if (!style.isConnected) return;
              style.textContent = renameKeyframes(
                scopeCss(rewriteCssUrls(text, href), scopeFor(screenId)),
                cssSuffix(screenId),
              );
            })
            .catch((error: unknown) => {
              if (!style.isConnected) return;
              console.warn(
                `[lab] ${href} could not be read as CSS, so it is linked unscoped `
                + '— its :root rules will reach the whole canvas.',
                error,
              );
              const link = document.createElement('link');
              link.rel = 'stylesheet';
              link.href = href;
              style.replaceWith(link);
            });
        }
      }
    }

    body.innerHTML = parsed.body;
    root.appendChild(body);

    /*
     * Scripts, re-created so they run.
     *
     * `innerHTML` never executes a script it parses, which is a security rule
     * rather than an oversight, so the only way to run the file's own code is
     * to build fresh nodes. They execute in this document's scope, which is
     * exactly what makes `document.getElementById` inside a prototype keep
     * working — as long as the mount is not behind a shadow root.
     */
    /*
     * One lifecycle per screen, so readiness is per screen.
     *
     * The canvas mounts many at once and each finishes on its own; a shared
     * flag would tell the fifth screen the page was ready before its own
     * scripts had run.
     */
    const life: ScreenLifecycle = { ready: false, waiting: [] };
    lifecycles.set(screenId, life);

    window.__labScreens = { ...window.__labScreens, [screenId]: body };
    // Reads the registry at call time rather than closing over it: screens
    // mount and unmount independently, and a captured copy would be stale for
    // every screen that arrived after this one.
    window.__labScope = (id: string) => scopedDocument(
      window.__labScreens?.[id] ?? body,
      lifecycles.get(id) ?? life,
    );

    /*
     * A file that wires buttons up with `onclick=` needs its functions to stay
     * global, so it keeps the raw scope and the shared-id risk that comes with
     * it. Everything else gets a `document` that means this screen.
     *
     * Said out loud, because the consequence is invisible and surprising: one
     * `onclick=` anywhere in the markup sends every `getElementById` in the
     * file back to whichever screen mounted first. A page that works alone and
     * misbehaves on a canvas of ten variants is a bad afternoon otherwise.
     */
    const scopeScripts = !usesInlineHandlers(parsed.body);
    if (!scopeScripts && parsed.scripts.some((spec) => !spec.src)) {
      console.warn(
        `[lab] ${screenId} uses inline on* handlers, so its scripts share the `
        + 'global scope. getElementById will find whichever screen mounted '
        + 'first. Move the handlers to addEventListener to scope it.',
      );
    }

    const added: HTMLScriptElement[] = [];
    for (const spec of parsed.scripts) {
      const script = document.createElement('script');
      if (spec.type) script.type = spec.type;
      if (spec.src) {
        script.src = spec.src;
      } else if (scopeScripts && !spec.module) {
        script.textContent = wrapScript(spec.text, screenId);
      } else {
        script.textContent = spec.text;
      }
      body.appendChild(script);
      added.push(script);
    }

    /*
     * Now the screen is as loaded as it is going to get.
     *
     * A microtask rather than immediately, so a script that registers a
     * listener and then keeps working still has its whole body run first —
     * the same order it would see in a real document.
     */
    queueMicrotask(() => announceReady(body, life));

    return () => {
      lifecycles.delete(screenId);
      /*
       * Tell the screen it is going away, before taking it away.
       *
       * Removing a script element does not stop what it started. An interval,
       * a rAF loop, a ResizeObserver or a window listener created by the
       * file's own code keeps running against a detached tree — and in
       * StrictMode, where every mount is torn down and rebuilt, that happens
       * on the very first render. The lab found it as a screen whose readings
       * came from an element no longer on the page.
       *
       * There is no way to reach inside a script and stop it, so the screen is
       * told and cleans up after itself, the same bargain as `lab:escape`.
       */
      body.dispatchEvent(new CustomEvent('lab:unmount'));
      for (const script of added) script.remove();
      root.textContent = '';
      const rest = { ...window.__labScreens };
      delete rest[screenId];
      window.__labScreens = rest;
    };
  }, [html, base, isolate, screenId]);

  /**
   * The contract, in the only shape a plain HTML file can read it.
   *
   * A React screen calls `useScreen()`. A file cannot, so the same facts go
   * onto its root as attributes and custom properties, which plain CSS and
   * three lines of vanilla JS can both reach.
   */
  useEffect(() => {
    const host = hostRef.current;
    const body = window.__labScreens?.[screenId] ?? host;
    if (!body) return undefined;
    /*
     * Told, not just marked.
     *
     * Four screens in one document means a bare `window.addEventListener(
     * 'keydown')` has all four answering one keypress — there is no per-window
     * anything to scope it with. The attribute says which screen owns the
     * keyboard, and these events say when that changed, so a screen can arm and
     * disarm instead of guessing from hover or `activeElement`.
     */
    const was = body.getAttribute('data-active');
    body.setAttribute('data-active', active ? 'true' : 'false');
    body.setAttribute('data-visible', visible ? 'true' : 'false');
    if (was !== null && was !== String(active)) {
      body.dispatchEvent(new CustomEvent(active ? 'lab:active' : 'lab:inactive'));
    }

    /*
     * The size comes from the screen's own box, not the frame's.
     *
     * They differ, and the difference matters: a frame keeps room for its
     * scrollbar only once this screen's content overflows, which depends on
     * the width the screen was given. So the frame reports the width it
     * offered, and the screen ends up with about ten pixels less. A screen
     * that lays out to the offered width overflows by exactly that much.
     *
     * Its own box is the answer after layout has settled, and observing it
     * closes the loop: content appears, a scrollbar takes its width, the
     * number corrects itself, and anything reading the property follows.
     */
    const write = () => {
      body.style.setProperty('--frame-width', `${body.clientWidth || frameSize.width}px`);
      body.style.setProperty('--frame-height', `${body.clientHeight || frameSize.height}px`);
    };
    write();
    const ro = new ResizeObserver(write);
    ro.observe(body);
    return () => ro.disconnect();
  }, [active, visible, frameSize, screenId]);

  /**
   * Escape arbitration for a file.
   *
   * The lab asks the screen first. A plain HTML screen answers by cancelling
   * the event — `preventDefault()` on `lab:escape` means "I had something open
   * and I closed it", and the lab stays where it is.
   */
  useEffect(() => {
    if (!active) return undefined;
    setEscapeInterceptor(() => {
      const body = window.__labScreens?.[screenId];
      if (!body) return false;
      const event = new CustomEvent('lab:escape', { cancelable: true, bubbles: false });
      body.dispatchEvent(event);
      return event.defaultPrevented;
    });
    return () => setEscapeInterceptor(null);
  }, [active, screenId, setEscapeInterceptor]);

  return (
    <div
      ref={hostRef}
      data-lab-html={screenId}
      style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}
    />
  );
}
