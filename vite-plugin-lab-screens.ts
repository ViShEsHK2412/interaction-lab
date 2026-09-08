import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Point the canvas at a folder that is not in this repo.
 *
 * The built-in registry globs `src/screens`, and a glob has to be a literal —
 * you cannot hand `import.meta.glob` a path decided at run time. So the folder
 * is scanned here instead, and the result is handed to the client as a module
 * that was written on the spot.
 *
 * This is what makes the lab worth running against work that already exists. A
 * folder of ten HTML variants becomes ten frames side by side, in place, with
 * no copying, no manifests and no build step — and editing one of the files
 * still hot-reloads exactly that frame.
 */

const VIRTUAL = 'virtual:lab-screens';
const RESOLVED = '\0' + VIRTUAL;

/** One page found on disk. */
interface Page {
  /** Path relative to the root that was scanned, always with forward slashes. */
  rel: string;
  /** Absolute path, for the import. */
  abs: string;
}

const isPage = (name: string) => /\.html?$/i.test(name);

/**
 * Pages in the folder, and in its immediate subfolders.
 *
 * Two levels rather than a full walk: an experiments folder holds pages beside
 * the odd `node_modules` and `shots` directory, and a recursive scan would
 * happily mount a dependency's documentation on the canvas.
 */
function scan(root: string): Page[] {
  const out: Page[] = [];

  const add = (dir: string, prefix: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const abs = resolve(dir, name);
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (stat.isFile() && isPage(name)) {
        out.push({ rel: prefix + name, abs: abs.split('\\').join('/') });
      }
    }
  };

  add(root, '');

  let dirs: string[] = [];
  try {
    dirs = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of dirs.sort()) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const abs = resolve(root, name);
    try {
      if (statSync(abs).isDirectory()) add(abs, name + '/');
    } catch { /* unreadable, skip */ }
  }

  return out;
}

export function labScreens(): Plugin {
  const configured = process.env['LAB_SCREENS'];
  const root = configured ? resolve(configured).split('\\').join('/') : null;

  return {
    name: 'lab-screens',

    config() {
      if (!root) return {};
      // The folder is outside the project, so the dev server has to be told it
      // may serve from there. Without this every page 403s and the canvas comes
      // up empty with nothing on screen to say why.
      return { server: { fs: { allow: [root] } } };
    },

    configResolved() {
      if (!root) return;
      const found = scan(root);
      // Said once, at startup, because "the canvas is empty" and "the folder
      // has no pages in it" look identical from the browser.
      if (found.length === 0) {
        console.warn(`\n[lab] No .html files in ${root}\n`);
      } else {
        console.log(`\n[lab] ${found.length} page${found.length === 1 ? '' : 's'} from ${root}\n`);
      }
    },

    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },

    load(id) {
      if (id !== RESOLVED) return null;
      if (!root) return 'export const root = null;\nexport const pages = {};\n';

      const found = scan(root);
      const imports = found
        .map((p, i) => `import __p${i} from ${JSON.stringify(`/@fs/${p.abs}?raw`)};`)
        .join('\n');
      const entries = found
        .map((p, i) => `  ${JSON.stringify(p.rel)}: __p${i},`)
        .join('\n');

      return `${imports}
export const root = ${JSON.stringify(root)};
export const pages = {
${entries}
};
`;
    },

    configureServer(server) {
      if (!root) return;
      server.watcher.add(root);

      // A file appearing or disappearing changes the registry itself, which is
      // built once at module scope, so the page has to come back rather than
      // patch itself. Edits to a file's contents are not this: those are a
      // plain `?raw` update and hot-replace the one frame.
      const changed = (path: string) => {
        if (!isPage(path)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };

      server.watcher.on('add', changed);
      server.watcher.on('unlink', changed);
    },
  };
}
