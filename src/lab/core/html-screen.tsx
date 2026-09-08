import { useEffect, useRef } from 'react';
import { useScreen } from '../screen-context';
import {
  BODY_ATTR, cssSuffix, parseHtmlDocument, renameKeyframes, scopeCss, scopeFor,
  usesInlineHandlers, wrapScript,
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
function scopedDocument(root: HTMLElement): Document {
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

export interface HtmlScreenProps {
  screenId: string;
  html: string;
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
export function HtmlScreen({ screenId, html, isolate }: HtmlScreenProps) {
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

    const parsed = parseHtmlDocument(html, document);
    const root: HTMLElement | ShadowRoot = isolate
      ? (host.shadowRoot ?? host.attachShadow({ mode: 'open' }))
      : host;

    root.textContent = '';

    // The screen's own root. Every rule in the file is rewritten to sit under
    // this, and the file's `<body class>` lands on it, so a prototype that
    // themes itself with a body class still themes itself.
    const body = document.createElement('div');
    // The id, not an empty marker: every screen carries this attribute, so a
    // stylesheet scoped to the bare attribute is scoped to every screen at
    // once and the last one mounted wins every token.
    body.setAttribute(BODY_ATTR, screenId);
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
        style.textContent = isolate
          ? sheet.value
          : renameKeyframes(scopeCss(sheet.value, scopeFor(screenId)), cssSuffix(screenId));
        root.appendChild(style);
      } else {
        // A stylesheet the file links out to. Left alone: rewriting a remote
        // sheet would mean fetching and re-parsing it, and a prototype's
        // linked sheet is nearly always a font.
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.value;
        root.appendChild(link);
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
    window.__labScreens = { ...window.__labScreens, [screenId]: body };
    // Reads the registry at call time rather than closing over it: screens
    // mount and unmount independently, and a captured copy would be stale for
    // every screen that arrived after this one.
    window.__labScope = (id: string) => scopedDocument(window.__labScreens?.[id] ?? body);

    // A file that wires buttons up with `onclick=` needs its functions to stay
    // global, so it keeps the raw scope and the shared-id risk that comes with
    // it. Everything else gets a `document` that means this screen.
    const scopeScripts = !usesInlineHandlers(parsed.body);

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

    return () => {
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
  }, [html, isolate, screenId]);

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
    body.setAttribute('data-active', active ? 'true' : 'false');
    body.setAttribute('data-visible', visible ? 'true' : 'false');

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
