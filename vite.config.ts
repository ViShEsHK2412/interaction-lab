import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { labFs } from './vite-plugin-lab-fs';
import { labScreens } from './vite-plugin-lab-screens';

export default defineConfig({
  plugins: [react(), labFs(), labScreens()],
  server: { port: 5190 },
});
