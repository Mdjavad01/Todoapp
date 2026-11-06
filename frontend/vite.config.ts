import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// گام ۲ — بیلد bazaar (VITE_PAYMENTS_BUILD=off): حذف فیزیکی هر متن/صفحه‌ی پرداخت از باندل
// با alias (نه runtime): صفحه‌ی پی‌وال → استاب بی‌پرداخت، خزانه‌ی متن‌ها → شاخه‌ی صادقانه‌ی بازار
const paymentsOff = process.env.VITE_PAYMENTS_BUILD === 'off';

// base './' تا بیلد در روت دامین و در زیرپوشه‌ی پیش‌نمایش هر دو کار کند
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      // ترتیب مهم است: استاب‌های bazaar باید قبل از '@' باشند وگرنه '@' زودتر مچ می‌شود
      ...(paymentsOff
        ? {
            '@/views/PaywallView': fileURLToPath(new URL('./src/views/PaywallView.bazaar.tsx', import.meta.url)),
            // v1.12.1 — خزانه‌ی متن‌های پرو/خرید: شاخه‌ی صادقانه‌ی بازار جایگزین شاخه‌ی latest می‌شود
            '@/lib/bazaarTexts': fileURLToPath(new URL('./src/lib/bazaarTexts.bazaar.ts', import.meta.url)),
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
