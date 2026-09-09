import type { ComponentType } from 'react';

/**
 * The in-page tools, mounted once for the whole canvas.
 *
 * align-ui, agentation, interface-kit and dialkit are all overlays that work
 * on one document. The canvas is one document — that is the reason screens are
 * mounted into it rather than into iframes — so mounting them here covers
 * every screen at once. One measuring pass reaches across two frames; one
 * annotation session covers ten variants. Per screen they would be four
 * toolbars fighting over the same click.
 *
 * None of them are dependencies of this repo. `npm run lab:tools` installs
 * them and writes `enabled.tsx` beside this file; without that file this is
 * nothing at all.
 */

/*
 * A glob, not an import, and that is the whole trick.
 *
 * `import('./enabled')` for a file that does not exist is a build error, so a
 * lab without the tools installed would not start. A glob that matches nothing
 * is an empty object, so the same code works whether or not the file is there.
 */
const enabled = import.meta.glob<{ Tools: ComponentType }>('./enabled.tsx', { eager: true });

const Tools = Object.values(enabled)[0]?.Tools ?? null;

export function Overlays() {
  if (!Tools) return null;
  return <Tools />;
}

/** Whether anything is actually mounted, so the HUD can say so. */
export const toolsInstalled = Tools !== null;
