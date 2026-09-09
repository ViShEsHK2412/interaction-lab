import type { Plugin } from 'vite';

/**
 * align-ui, if it is installed.
 *
 * The other tools are components and mount themselves from the client. This
 * one is a Vite plugin, which means it has to be in the config — and a config
 * that imports a package the project may not have does not load at all, so the
 * lab would refuse to start until you installed a measuring tool you had not
 * asked for.
 *
 * So it is resolved at startup instead of imported at parse time. Installed,
 * it is on. Not installed, this is an empty array and nothing anywhere had to
 * change. `npm run lab:tools` is the whole setup either way.
 */
export async function labTools(): Promise<Plugin[]> {
  try {
    const mod = await import('align-ui/vite') as { default?: () => Plugin };
    const align = mod.default;
    if (typeof align !== 'function') {
      console.warn('\n[lab] align-ui is installed but exports no plugin.\n');
      return [];
    }
    console.log('\n[lab] align-ui on: Ctrl/Cmd + Shift + A\n');
    return [align()];
  } catch {
    // Not installed. The one expected outcome, and not worth a word about it.
    return [];
  }
}
