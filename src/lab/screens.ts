import type { ComponentType } from 'react';
import type { ScreenManifest } from './screen-manifest';
import {
  DEFAULT_HTML_SIZE, firstFreeRow, htmlScreenId, orderHtmlFiles, tilePosition, titleFromSlug,
} from './core/html-screens';

/**
 * The registry, discovered rather than declared.
 *
 * A folder under `src/screens` with a `screen.ts` in it *is* a screen, and so
 * is a folder with nothing but `.html` files in it. There is no list to keep
 * in step, which is what lets the lab's duplicate and delete be real file
 * operations: copying a folder adds a screen, and the canvas finds it on the
 * next reload.
 */
export interface ScreenDef {
  id: string;
  name: string;
  width: number;
  height: number;
  position: { x: number; y: number };
  defaultPosition: { x: number; y: number };
  /** The folder, which is what file operations target. */
  dir: string;
  /** A React screen, or null when this screen is an HTML file. */
  component: ComponentType | null;
  /** The HTML source, already loaded, or null when this screen is a component. */
  html: string | null;
  /** The file the HTML came from, for the label and for error messages. */
  htmlFile: string | null;
  /** Mount HTML inside a shadow root. Meaningless for component screens. */
  isolate: boolean;
  /**
   * This screen is the only one its folder produces.
   *
   * File operations target folders, so duplicating or deleting a screen from
   * a folder that holds ten variants would take the other nine with it. The
   * canvas checks this before it offers to touch the disk.
   */
  solo: boolean;
}

const manifests = import.meta.glob<{ default: ScreenManifest }>(
  '../screens/*/screen.ts',
  { eager: true },
);

/**
 * Every HTML file under every screen folder, as text.
 *
 * `?raw` rather than a URL because the file is mounted into this document,
 * not fetched into a frame of its own. Eager because the registry is built
 * once at module scope and a promise there would make every consumer async
 * for no gain.
 */
const pages = import.meta.glob<string>(
  '../screens/*/*.html',
  { query: '?raw', import: 'default', eager: true },
);

function dirOf(path: string): string | undefined {
  return path.split('/').at(-2);
}

function fileOf(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function build(): ScreenDef[] {
  const out: ScreenDef[] = [];
  const seen = new Set<string>();
  /** Auto-placed screens are tiled in the order they are discovered. */
  let tiled = 0;

  // Which HTML files sit in which folder, so a folder can be resolved once.
  const byDir = new Map<string, Map<string, string>>();
  for (const [path, html] of Object.entries(pages)) {
    const dir = dirOf(path);
    if (!dir) continue;
    let files = byDir.get(dir);
    if (!files) { files = new Map(); byDir.set(dir, files); }
    files.set(fileOf(path), html);
  }

  const claim = (preferred: string, fallback: string): string | null => {
    // Two screens claiming one id is a real possibility after a duplicate that
    // did not finish patching, and the canvas cannot tell them apart. Fall
    // back to something unique by construction.
    const id = seen.has(preferred) ? fallback : preferred;
    if (seen.has(id)) return null;
    seen.add(id);
    return id;
  };

  // ── Folders with a manifest ────────────────────────────────────────────
  for (const [path, mod] of Object.entries(manifests)) {
    const dir = dirOf(path);
    const manifest = mod?.default;
    if (!dir || !manifest) continue;

    const id = claim(manifest.id ?? dir, dir);
    if (!id) continue;

    const base = {
      id,
      dir,
      name: manifest.name,
      width: manifest.width,
      height: manifest.height,
      position: manifest.position,
      defaultPosition: manifest.position,
      solo: true,
    };

    if (manifest.src) {
      const file = fileOf(manifest.src);
      const html = byDir.get(dir)?.get(file);
      if (html === undefined) {
        // A manifest naming a file that is not there is a broken screen, not a
        // silent absence: it would otherwise vanish from the canvas with no
        // hint of why, which is the worst way to learn about a typo.
        console.error(
          `[lab] ${dir}/screen.ts points at "${manifest.src}", which is not in the folder.`,
        );
        continue;
      }
      out.push({
        ...base,
        component: null,
        html,
        htmlFile: file,
        isolate: manifest.isolate === true,
      });
    } else if (manifest.component) {
      out.push({
        ...base, component: manifest.component, html: null, htmlFile: null, isolate: true,
      });
    }
  }

  // Everything above declared where it goes. The tiled screens start below
  // all of it rather than on top of it.
  const startY = firstFreeRow(out);

  // ── Folders that are just HTML ─────────────────────────────────────────
  for (const [dir, files] of byDir) {
    // A manifest in the folder decides what the folder is. Its other HTML
    // files are references, screenshots-in-waiting and half-finished ideas,
    // and putting them on the canvas uninvited would be a surprise.
    if (Object.keys(manifests).some((p) => dirOf(p) === dir)) continue;

    const ordered = orderHtmlFiles([...files.keys()]);
    const solo = ordered.length === 1;

    for (const file of ordered) {
      const id = claim(htmlScreenId(dir, file), `${dir}/${file}`);
      if (!id) continue;
      const position = tilePosition(tiled++, DEFAULT_HTML_SIZE, undefined, undefined, startY);
      out.push({
        id,
        dir,
        name: solo || file.replace(/\.html?$/i, '').toLowerCase() === 'index'
          ? titleFromSlug(dir)
          : titleFromSlug(file),
        width: DEFAULT_HTML_SIZE.width,
        height: DEFAULT_HTML_SIZE.height,
        position,
        defaultPosition: position,
        component: null,
        html: files.get(file) ?? '',
        htmlFile: file,
        // Light DOM. A shadow root would cut the file's own scripts off from
        // `document.getElementById`, which is how a prototype finds itself.
        isolate: false,
        solo,
      });
    }
  }

  // Stable order, so the canvas and the Tab cycle do not reshuffle per reload.
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export const SCREENS: ScreenDef[] = build();
