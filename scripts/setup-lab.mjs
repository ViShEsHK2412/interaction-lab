#!/usr/bin/env node
/**
 * Set up the whole rig against a folder of prototypes.
 *
 *   node setup-lab.mjs <folder>
 *
 * One command, from nothing: clone or update the lab, install the latest of
 * every tool, and open that folder on the canvas with all of them over it.
 * This file is self-contained on purpose — copy it anywhere, hand it to an
 * agent, point it at a folder. It needs `git` and `node` and nothing else.
 *
 *   node setup-lab.mjs ./Experiments/chapter-card-lab
 *   node setup-lab.mjs ./some-folder --lab ~/tools/interaction-lab --port 5200
 *   node setup-lab.mjs ./some-folder --no-open     set up, do not start
 *
 * Everything is fetched fresh each run. agentation moves quickly, and align-ui
 * and the lab are yours and move faster — a rig that pins whatever it first saw
 * is a rig that goes stale without saying so, and the whole point of one
 * command is not having to remember which piece needs updating today.
 *
 * The folder itself is only ever read. Nothing is copied into it, nothing is
 * written to it, and the lab refuses to duplicate, delete or rename anything
 * that lives outside its own project.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const LAB_REPO = 'https://github.com/ViShEsHK2412/interaction-lab.git';

// ── Arguments ───────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? null : argv[at + 1] ?? null;
};
const has = (name) => argv.includes(name);
const target = argv.find((a) => !a.startsWith('-') && argv[argv.indexOf(a) - 1] !== '--lab'
  && argv[argv.indexOf(a) - 1] !== '--port');

if (!target || has('--help') || has('-h')) {
  process.stdout.write(`
  node setup-lab.mjs <folder> [options]

    --lab <path>   where to keep the lab   (default ~/.interaction-lab)
    --port <n>     dev server port         (default 5190)
    --no-open      set up, but do not start
    --no-tools     just the canvas, no overlays

  Clones or updates interaction-lab, installs the latest align-ui, agentation
  and dialkit, and opens <folder> on the canvas. The folder is read, never
  written.

`);
  process.exit(target ? 0 : 1);
}

const folder = resolve(target);
const labDir = resolve(flag('--lab') ?? resolve(homedir(), '.interaction-lab'));
const port = flag('--port') ?? '5190';

// ── The folder has to be worth opening ──────────────────────────────────────

if (!existsSync(folder) || !statSync(folder).isDirectory()) {
  process.stderr.write(`\n  Not a folder: ${folder}\n\n`);
  process.exit(1);
}

/**
 * Count the pages before doing anything else.
 *
 * Cloning a repo and installing five packages to arrive at an empty canvas is
 * a bad way to find out the path had a typo in it. The lab scans a folder and
 * one level under it, so this looks in the same two places.
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
look(folder, '');
for (const name of readdirSync(folder).sort()) {
  if (name.startsWith('.') || name === 'node_modules') continue;
  try {
    if (statSync(resolve(folder, name)).isDirectory()) look(resolve(folder, name), `${name}/`);
  } catch { /* unreadable, skip */ }
}

if (pages.length === 0) {
  process.stderr.write(
    `\n  No .html files in ${folder}\n  (looked in the folder and one level down)\n\n`,
  );
  process.exit(1);
}

// ── Steps ───────────────────────────────────────────────────────────────────

const shell = process.platform === 'win32';
const step = (title) => process.stdout.write(`\n  ${title}\n`);

function run(cmd, args, cwd) {
  const done = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell });
  if (done.status !== 0) {
    process.stderr.write(`\n  Failed: ${cmd} ${args.join(' ')}\n\n`);
    process.exit(done.status ?? 1);
  }
}

process.stdout.write(
  `\n  ${pages.length} page${pages.length === 1 ? '' : 's'} in ${folder}\n`
  + `  ${pages.slice(0, 6).join(', ')}${pages.length > 6 ? `, and ${pages.length - 6} more` : ''}\n`,
);

if (existsSync(resolve(labDir, '.git'))) {
  step(`Updating the lab in ${labDir}`);
  /*
   * Fetch and reset rather than pull.
   *
   * This checkout is a tool, not a working copy — nobody edits it, and a pull
   * that stops on a conflict or a dirty file turns one command into a debugging
   * session about a repo the user never opened.
   */
  run('git', ['fetch', '--depth', '1', 'origin', 'main'], labDir);
  run('git', ['reset', '--hard', 'origin/main'], labDir);
} else {
  step(`Cloning the lab into ${labDir}`);
  run('git', ['clone', '--depth', '1', LAB_REPO, labDir]);
}

step('Installing the lab');
run('npm', ['install'], labDir);

if (!has('--no-tools')) {
  step('Installing the tools, latest of each');
  run('npm', ['run', 'lab:tools'], labDir);
}

if (has('--no-open')) {
  process.stdout.write(
    `\n  Ready. To open it:\n`
    + `      cd ${labDir}\n`
    + `      npm run lab -- ${folder} --port ${port}\n\n`,
  );
  process.exit(0);
}

step(`Opening ${folder} on the canvas`);
process.stdout.write(
  '\n  Double-click a screen to use it, Esc to come back out.\n'
  + '  Shift 1 fits everything. Shift 0 is 100%, which is where you measure.\n'
  + '  align-ui is Ctrl/Cmd + Shift + A.\n\n',
);

const child = spawn('npm', ['run', 'lab', '--', folder, '--port', port], {
  cwd: labDir,
  stdio: 'inherit',
  shell,
});
child.on('exit', (code) => process.exit(code ?? 0));
