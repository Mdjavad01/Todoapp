import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// base './' تا بیلد در روت دامین و در زیرپوشه‌ی پیش‌نمایش هر دو کار کند
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2018',
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    host: true,
  },
});
