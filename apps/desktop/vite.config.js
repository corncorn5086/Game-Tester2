import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // Electron loads dist/index.html from the filesystem
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 }
});
