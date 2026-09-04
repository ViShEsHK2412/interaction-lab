import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

/**
 * Real file operations, behind the dev server only.
 *
 * Duplicating and deleting a screen are file operations, and pretending
 * otherwise is what makes a canvas tool a toy: a duplicate that only exists in
 * localStorage disappears the first time someone clones the repo. So the lab
 * asks the dev server to copy a folder, and the folder is really copied.
 *
 * There is no production build of this. `apply: 'serve'` means the plugin does
 * not exist in a build, and the client falls back to doing nothing, so the
 * canvas still works with the file half skipped.
 */

const PREFIX = '/__lab-fs/';
const TRASH = '.lab-trash';

interface Options {
  /** Where the screen folders live, relative to the project root. */
  screensDir?: string;
}

/** A folder name that cannot escape the screens directory. */
function safeName(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) return null;
  if (value === '.' || value === '..') return null;
  return value;
}

async function readBody(req: { on(ev: string, cb: (c?: unknown) => void): void }): Promise<unknown> {
  const chunks: Buffer[] = [];
  await new Promise<void>((done) => {
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => done());
  });
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

/**
 * Rewrite one field in a manifest without parsing the file as code.
 *
 * A regex rather than an AST because the manifest is ours and its shape is
 * fixed; reaching for a TypeScript parser to change one string literal would
 * be a dependency and a build step for no gain.
 */
function patchField(source: string, field: string, value: string): string {
  const pattern = new RegExp(`(${field}\\s*:\\s*)(['"\`])(?:\\\\.|(?!\\2).)*\\2`);
  if (!pattern.test(source)) return source;
  return source.replace(pattern, `$1'${value.replace(/'/g, "\\'")}'`);
}

function patchPosition(source: string, x: number, y: number): string {
  return source.replace(
    /(position\s*:\s*\{)[^}]*\}/,
    `$1 x: ${Math.round(x)}, y: ${Math.round(y)} }`,
  );
}

export function labFs(options: Options = {}): Plugin {
  const rel = options.screensDir ?? 'src/screens';

  return {
    name: 'lab-fs',
    // Serve only. A production build has no dev server to ask, and the client
    // treats a failed request as "the file half did not happen".
    apply: 'serve',

    configureServer(server: ViteDevServer) {
      const root = server.config.root;
      const screens = resolve(root, rel);
      const trash = join(screens, TRASH);

      /** Everything under the screens directory, and nowhere else. */
      const dirOf = (name: string) => {
        const path = join(screens, name);
        if (!path.startsWith(screens)) return null;
        return path;
      };

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(PREFIX)) return next();
        const action = req.url.slice(PREFIX.length).split('?')[0];
        const body = await readBody(req);
        const data = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

        const reply = (status: number, payload: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        try {
          if (action === 'duplicate') {
            const from = safeName(data['dir']);
            const to = safeName(data['as']);
            if (!from || !to) return reply(400, { error: 'bad name' });
            const src = dirOf(from);
            const dst = dirOf(to);
            if (!src || !dst || !existsSync(src)) return reply(404, { error: 'no such screen' });
            if (existsSync(dst)) return reply(409, { error: 'already exists' });
            await cp(src, dst, { recursive: true });

            // The copy needs its own identity, or two screens claim one id and
            // the canvas cannot tell them apart.
            const manifest = join(dst, 'screen.ts');
            if (existsSync(manifest)) {
              let source = await readFile(manifest, 'utf8');
              source = patchField(source, 'id', to);
              source = patchField(source, 'name', String(data['name'] ?? to));
              if (typeof data['x'] === 'number' && typeof data['y'] === 'number') {
                source = patchPosition(source, data['x'], data['y']);
              }
              await writeFile(manifest, source, 'utf8');
            }
            return reply(200, { ok: true, dir: to });
          }

          if (action === 'delete') {
            const name = safeName(data['dir']);
            if (!name) return reply(400, { error: 'bad name' });
            const src = dirOf(name);
            if (!src || !existsSync(src)) return reply(404, { error: 'no such screen' });
            await mkdir(trash, { recursive: true });
            // A token, not the folder name: deleting the same screen twice in
            // one session must not have the second one clobber the first.
            const token = `${name}-${Date.now().toString(36)}`;
            await rename(src, join(trash, token));
            return reply(200, { ok: true, token });
          }

          if (action === 'restore') {
            const token = safeName(data['token']);
            const name = safeName(data['dir']);
            if (!token || !name) return reply(400, { error: 'bad name' });
            const from = join(trash, token);
            const to = dirOf(name);
            if (!to || !existsSync(from)) return reply(404, { error: 'nothing to restore' });
            if (existsSync(to)) return reply(409, { error: 'already exists' });
            await rename(from, to);
            return reply(200, { ok: true });
          }

          if (action === 'rename') {
            const name = safeName(data['dir']);
            const label = data['name'];
            if (!name || typeof label !== 'string') return reply(400, { error: 'bad name' });
            const manifest = join(dirOf(name) ?? '', 'screen.ts');
            if (!existsSync(manifest)) return reply(404, { error: 'no manifest' });
            const source = await readFile(manifest, 'utf8');
            await writeFile(manifest, patchField(source, 'name', label), 'utf8');
            return reply(200, { ok: true });
          }

          if (action === 'set-positions') {
            const entries = data['screens'];
            if (typeof entries !== 'object' || entries === null) {
              return reply(400, { error: 'bad payload' });
            }
            for (const [id, at] of Object.entries(entries as Record<string, unknown>)) {
              const name = safeName(id);
              if (!name) continue;
              const manifest = join(dirOf(name) ?? '', 'screen.ts');
              if (!existsSync(manifest)) continue;
              const p = at as { x?: unknown; y?: unknown };
              if (typeof p.x !== 'number' || typeof p.y !== 'number') continue;
              const source = await readFile(manifest, 'utf8');
              await writeFile(manifest, patchPosition(source, p.x, p.y), 'utf8');
            }
            return reply(200, { ok: true });
          }

          if (action === 'empty-trash') {
            await rm(trash, { recursive: true, force: true });
            return reply(200, { ok: true });
          }

          return reply(404, { error: 'unknown action' });
        } catch (error) {
          return reply(500, { error: String(error) });
        }
      });

      /**
       * Vite's own glob watcher misses directory-level changes, so a folder
       * appearing or going away does not invalidate the registry on its own.
       * Watching the screens directory and forcing a reload does.
       */
      const watched = resolve(root, rel);
      server.watcher.add(watched);
      const bounce = (path: string) => {
        if (!path.startsWith(watched) || path.includes(TRASH)) return;
        if (!path.endsWith('screen.ts') && !path.endsWith('.tsx')) return;
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', bounce);
      server.watcher.on('unlink', bounce);
      server.watcher.on('addDir', () => server.ws.send({ type: 'full-reload' }));
      server.watcher.on('unlinkDir', () => server.ws.send({ type: 'full-reload' }));
    },
  };
}


