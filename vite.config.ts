import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { labFs } from './vite-plugin-lab-fs';
import { labScreens } from './vite-plugin-lab-screens';
import { labTools } from './vite-plugin-lab-tools';

/*
 * Async, so align-ui can be resolved rather than imported.
 *
 * It is a plugin, not a component, so it has to be here — but importing a
 * package the project may not have would stop the lab starting at all. Asking
 * for it at startup means it is on when installed and absent when not, with
 * nothing to edit either way.
 */
export default defineConfig(async () => ({
  plugins: [react(), labFs(), labScreens(), ...(await labTools())],
  server: { port: 5190 },
}));
