import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScreenProvider, type ScreenState } from './screen-context';
import { HtmlScreen } from './core/html-screen';
import { SCREENS } from './screens';

/**
 * One screen, alone, at its real size.
 *
 * `?only=<id>` on the lab's URL. There was no way to see a single variant
 * without the canvas scaling it, which made an honest screenshot impossible —
 * and asking the dev server for `/screens/name.html` returns the whole canvas
 * rather than a 404, because Vite answers anything it does not recognise with
 * the SPA shell. Silently wrong is worse than missing.
 *
 * No canvas, no camera, no transform: the screen is the page, so a rect
 * measures what it says and a screenshot is the thing itself.
 */
export function OnlyScreen({ id }: { id: string }) {
  const def = useMemo(
    () => SCREENS.find((s) => s.id === id)
      ?? SCREENS.find((s) => s.htmlFile === id)
      ?? SCREENS.find((s) => s.htmlFile === `${id}.html`)
      ?? null,
    [id],
  );

  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /*
   * The contract, told the truth for once.
   *
   * Nothing is scaled here, so a client position *is* a frame position and
   * `clientToFrame` is the identity. `zoom` is 1 for the same reason — which
   * is the whole point of this route.
   */
  const clientToFrame = useCallback(
    (p: { clientX: number; clientY: number }) => ({ x: p.clientX, y: p.clientY }),
    [],
  );

  const env: ScreenState = useMemo(() => ({
    screenId: def?.id ?? id,
    active: true,
    visible: true,
    frameSize: size,
    zoom: 1,
    clientToFrame,
    setEscapeInterceptor: () => {},
  }), [def, id, size, clientToFrame]);

  if (!def) {
    // Naming what is there beats an empty page and a guess.
    return (
      <div style={{ font: '14px/1.6 ui-monospace, monospace', padding: 24 }}>
        <p style={{ margin: '0 0 12px' }}>
          No screen called <b>{id}</b>. On this canvas:
        </p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {SCREENS.map((s) => (
            <li key={s.id}>
              <a href={`?only=${encodeURIComponent(s.id)}`}>{s.id}</a>
              {s.htmlFile ? ` — ${s.htmlFile}` : ' — a React screen'}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const Component = def.component;

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'auto' }}>
      <ScreenProvider value={env}>
        {Component ? <Component /> : (
          <HtmlScreen
            screenId={def.id}
            html={def.html ?? ''}
            file={def.htmlFile ?? def.id}
            base={def.base}
            isolate={def.isolate}
          />
        )}
      </ScreenProvider>
    </div>
  );
}

/** The screen asked for in the URL, or null for the canvas. */
export function onlyScreenId(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('only');
  } catch {
    return null;
  }
}
