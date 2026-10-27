import type { CapacitorConfig } from '@capacitor/cli';

/**
 * کارام — پیکربندی اپ اندروید (فاز ۶)
 * وب‌ویو همان فرانت وب را اجرا می‌کند؛ دیتای آفلاین IndexedDB و سینک ابری مشترک است.
 * شناسه‌ی پکیج قبل از اولین انتشار در کافه بازار قطعی می‌شود — بعد از انتشار قابل تغییر نیست!
 */
const config: CapacitorConfig = {
  appId: 'ir.hojre24shop.app',
  appName: 'کارام',
  webDir: 'www',
  server: {
    // محتوای بسته‌بندی‌شده با اسکیم https سرو می‌شود تا IndexedDB/سرویس‌ها پایدار باشند
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    // فاز ۴ — یادآور بومی: آیکن سفید مونوکروم سینی اعلان + رنگ هویت کارام
    LocalNotifications: {
      smallIcon: 'ic_stat_karam',
      iconColor: '#00685F',
    },
  },
};

export default config;
