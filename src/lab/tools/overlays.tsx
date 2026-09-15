import type { ComponentType } from 'react';
import { publishWhere } from './where';

/**
 * The in-page tools, mounted once for the whole canvas.
 *
 * align-ui, agentation and dialkit are all overlays that work on one document.
 * The canvas is one document — that is the reason screens are mounted into it
 * rather than into iframes — so mounting them here covers every screen at once.
 * One measuring pass reaches across two frames; one annotation session covers
 * ten variants. Per screen they would be three toolbars fighting over the same
 * click.
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

/*
 * Published whether or not any tool is installed.
 *
 * A Playwright driver, a console, or a tool the lab has never heard of can all
 * ask which file an element belongs to. That is worth having on its own — the
 * canvas is the only thing that knows.
 */
publishWhere();

export function Overlays() {
  if (!Tools) return null;
  return <Tools />;
}

/** Whether anything is actually mounted, so the HUD can say so. */
export const toolsInstalled = Tools !== null;
