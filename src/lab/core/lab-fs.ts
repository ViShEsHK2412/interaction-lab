/**
 * The client for the dev server's file operations.
 *
 * Every call is allowed to fail. In a production build the plugin does not
 * exist, so the request 404s and the canvas simply carries on with the file
 * half skipped: duplicating still puts a copy on screen, it just does not
 * survive a reload. That is the right failure, because the alternative is a
 * canvas that refuses to work outside a dev server.
 */

const PREFIX = '/__lab-fs/';

async function call(action: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(PREFIX + action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;                       // no dev server, or it said no
  }
}

export const labFs = {
  duplicate: (dir: string, as: string, name: string, at: { x: number; y: number }) =>
    call('duplicate', { dir, as, name, x: at.x, y: at.y }),
  /** Resolves to the trash token, which is what undo needs to put it back. */
  async remove(dir: string): Promise<string | null> {
    const out = await call('delete', { dir });
    return typeof out?.['token'] === 'string' ? out['token'] : null;
  },
  restore: (dir: string, token: string) => call('restore', { dir, token }),
  rename: (dir: string, name: string) => call('rename', { dir, name }),
  setPositions: (screens: Record<string, { x: number; y: number }>) =>
    call('set-positions', { screens }),
};

/**
 * A folder name for a copy of `dir` that nothing else is using.
 *
 * `-copy`, then `-copy-2`, which is what every file manager does and so needs
 * no explaining.
 */
export function copyName(dir: string, taken: readonly string[]): string {
  const base = `${dir}-copy`;
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}
