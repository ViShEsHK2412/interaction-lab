#!/usr/bin/env node
/**
 * Put a folder of prototypes on the canvas.
 *
 *   npm run lab -- ../some/experiments/chapter-card-lab
 *
 * Nothing is copied and nothing is written. The folder is scanned, every page
 * in it becomes a frame, and editing one of those files hot-reloads that frame
 * where it sits. With no folder given this is `npm run dev`: the lab's own
 * screens, and nothing else.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('-'));
const target = argv.find((a) => !a.startsWith('-'));

if (flags.includes('--help') || flags.includes('-h')) {
  process.stdout.write(`
  npm run lab -- <folder>        every .html in that folder, on one canvas
  npm run lab                    just the lab's own screens
  npm run lab -- <folder> --port 5200

  The folder is read, never written. Duplicate, delete and rename are the
  lab's own screens only — it will not touch work that lives somewhere else.

`);
  process.exit(0);
}

const env = { ...process.env };

if (target) {
  const root = resolve(target);

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    process.stderr.write(`\n  Not a folder: ${root}\n\n`);
    process.exit(1);
  }

  /*
   * Count the pages before starting, and say so.
   *
   * A folder with no `.html` in it produces a canvas holding only the lab's
   * own demo screens, which looks exactly like a canvas that failed to find
   * anything. One line here is the difference between a puzzle and a typo.
   */
  const pages = [];
  const look = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const abs = resolve(dir, name);
      let stat;
      try { stat = statSync(abs); } catch { continue; }
      if (stat.isFile() && /\.html?$/i.test(name)) pages.push(prefix + name);
    }
  };
  look(root, '');
  for (const name of readdirSync(root).sort()) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const abs = resolve(root, name);
    try {
      if (statSync(abs).isDirectory()) look(abs, `${name}/`);
    } catch { /* unreadable, skip */ }
  }

  if (pages.length === 0) {
    process.stderr.write(`\n  No .html files in ${root}\n`
      + '  (looked in the folder and one level down)\n\n');
    process.exit(1);
  }

  env['LAB_SCREENS'] = root;
  process.stdout.write(`\n  ${pages.length} page${pages.length === 1 ? '' : 's'} from ${root}\n`
    + `  ${pages.slice(0, 6).join(', ')}${pages.length > 6 ? `, and ${pages.length - 6} more` : ''}\n`);
}

const port = flags.includes('--port')
  ? argv[argv.indexOf('--port') + 1]
  : null;

const args = ['vite', ...(port ? ['--port', port] : [])];
const child = spawn('npx', args, { env, stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 0));
