import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { labFs } from './vite-plugin-lab-fs';

export default defineConfig({
  plugins: [react(), labFs()],
  server: { port: 5190 },
});
