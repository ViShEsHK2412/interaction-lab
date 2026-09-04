import type { ScreenManifest } from './screen-manifest';

/**
 * The registry, discovered rather than declared.
 *
 * A folder under `src/screens` with a `screen.ts` in it *is* a screen. There
 * is no list to keep in step, which is what lets the lab's duplicate and
 * delete be real file operations: copying a folder adds a screen, and the
 * canvas finds it on the next reload.
 */
export interface ScreenDef extends Required<Omit<ScreenManifest, 'id'>> {
  id: string;
  /** The folder, which is what file operations target. */
  dir: string;
  defaultPosition: { x: number; y: number };
}

const modules = import.meta.glob<{ default: ScreenManifest }>(
  '../screens/*/screen.ts',
  { eager: true },
);

function build(): ScreenDef[] {
  const out: ScreenDef[] = [];
  const seen = new Set<string>();

  for (const [path, mod] of Object.entries(modules)) {
    const dir = path.split('/').at(-2);
    const manifest = mod?.default;
    if (!dir || !manifest) continue;

    const id = manifest.id ?? dir;
    // Two screens claiming one id is a real possibility after a duplicate that
    // did not finish patching, and the canvas cannot tell them apart. Fall
    // back to the folder, which is unique by construction.
    const unique = seen.has(id) ? dir : id;
    if (seen.has(unique)) continue;
    seen.add(unique);

    out.push({
      id: unique,
      dir,
      name: manifest.name,
      width: manifest.width,
      height: manifest.height,
      position: manifest.position,
      defaultPosition: manifest.position,
      component: manifest.component,
    });
  }

  // Stable order, so the canvas and the Tab cycle do not reshuffle per reload.
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}

export const SCREENS: ScreenDef[] = build();
