import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// گام ۲ — بیلد bazaar (VITE_PAYMENTS_BUILD=off): صفحه‌ی اشتراک با استابِ بدون پرداخت
// جایگزین می‌شود تا PaywallView واقعی + شیت روش پرداخت به‌طور فیزیکی از باندل حذف شوند.
const paymentsOff = process.env.VITE_PAYMENTS_BUILD === 'off';

// base './' تا بیلد در روت دامین و در زیرپوشه‌ی پیش‌نمایش هر دو کار کند
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      // ترتیب مهم است: استاب باید قبل از '@' باشد وگرنه '@' زودتر مچ می‌شود
      ...(paymentsOff
        ? {
            '@/views/PaywallView': fileURLToPath(new URL('./src/views/PaywallView.bazaar.tsx', import.meta.url)),
          }
        : {}),
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
