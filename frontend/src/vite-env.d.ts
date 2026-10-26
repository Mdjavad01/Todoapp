/// <reference types="vite/client" />

/** متغیرهای بیلد کارام — گام ۲: VITE_PAYMENTS_BUILD=off برای بیلد بدون پرداخت (حالت bazaar) */
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_API_EXTRA_QUERY?: string;
  readonly VITE_PAYMENTS_BUILD?: string;
}
