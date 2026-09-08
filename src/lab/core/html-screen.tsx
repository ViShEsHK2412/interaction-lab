import { useEffect, useRef } from 'react';
import { useScreen } from '../screen-context';
import { BODY_ATTR, parseHtmlDocument, scopeCss } from './html-screens';

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
  }
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
    body.setAttribute(BODY_ATTR, '');
    if (parsed.bodyClass) body.className = parsed.bodyClass;

    for (const sheet of parsed.styles) {
      if (sheet.kind === 'text') {
        const style = document.createElement('style');
        style.textContent = isolate ? sheet.value : scopeCss(sheet.value);
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
    const added: HTMLScriptElement[] = [];
    for (const spec of parsed.scripts) {
      const script = document.createElement('script');
      if (spec.type) script.type = spec.type;
      if (spec.src) script.src = spec.src;
      else script.textContent = spec.text;
      body.appendChild(script);
      added.push(script);
    }

    window.__labScreens = { ...window.__labScreens, [screenId]: body };

    return () => {
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
    if (!body) return;
    body.setAttribute('data-active', active ? 'true' : 'false');
    body.setAttribute('data-visible', visible ? 'true' : 'false');
    body.style.setProperty('--frame-width', `${frameSize.width}px`);
    body.style.setProperty('--frame-height', `${frameSize.height}px`);
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

  return <div ref={hostRef} data-lab-html={screenId} style={{ minHeight: '100%' }} />;
}
