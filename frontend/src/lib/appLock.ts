/**
 * کارام — ماشین حالت خالص قفل بیومتریک (فاز ۳)
 *
 * طراحی:
 *  - این ماژول «خالص» است: هیچ وابستگی به پل بومی/IndexedDB/React ندارد و
 *    کامل با ساعت و شبیه‌ساز تست‌پذیر است (هم‌الگوی reminderPlan).
 *  - پل بومی در lib/biometricBridge.ts است؛ store فقط این دو را به هم می‌دوزد.
 *
 * قاعده‌ی طلایی — «هرگز کاربر را حبس نکن»:
 *  - اگر بیومتریک/رمز دستگاه در دسترس نباشد، قفل «باز» می‌ماند (fail-open) و علتش
 *    در lastMessage ثبت می‌شود تا کارت تنظیمات صادقانه نشانش بدهد.
 *  - کلید قفل پیش‌فرض «خاموش» است و فقط با تأیید زنده‌ی بیومتریک روشن می‌شود
 *    (فعال‌سازی بدون تست = قفلی که شاید باز نشود، هرگز ثبت نمی‌شود).
 *  - قفل فقط در اپ اندروید معنا دارد؛ وب هرگز قفل نمی‌شود.
 */

/** نتیجه‌ی یک تلاش احراز هویت (هم‌قرارداد با biometricBridge) */
export type UnlockResult = 'ok' | 'cancel' | 'fail' | 'unavailable';

/** محیطی که تصمیم‌های قفل بر اساس آن گرفته می‌شود — از store می‌آید */
export interface LockEnv {
  /** آیا در اپ اندروید هستیم؟ (وب هرگز قفل نمی‌شود) */
  native: boolean;
  /** آیا کاربر قفل را در تنظیمات روشن کرده؟ */
  enabled: boolean;
  /** آیا بیومتریک/رمز دستگاه همین حالا قابل استفاده است؟ */
  available: boolean;
}

/** وضعیت قفل — در store نگه‌داری می‌شود؛ سطح نشست است (پایداری فقط کلید روشن/خاموش در prefs) */
export interface LockState {
  /** صفحه‌ی قفل بالای اپ باشد؟ */
  locked: boolean;
  /** قفل به‌خاطر دردسترس‌نبودن بیومتریک این نشست برداشته شد (تا پایان فرایند اعمال نمی‌شود) */
  failOpen: boolean;
  /** تعداد تلاش‌های ناموفق در این قفل شدن (فقط برای نمایش/تست) */
  attempts: number;
  /** آخرین پیام فارسی برای نمایش روی صفحه‌ی قفل / کارت تنظیمات */
  lastMessage: string | null;
}

export const initialLockState: LockState = { locked: false, failOpen: false, attempts: 0, lastMessage: null };

export type LockEvent =
  | { type: 'cold-start' }
  | { type: 'backgrounded' }
  | { type: 'unlock-result'; result: UnlockResult; message?: string }
  | { type: 'lock-disabled' };

/**
 * تصمیم قفلِ شروعِ سرد (اولین اجرای فرایند):
 *  - وب یا کلید خاموش → هرگز قفل.
 *  - کلید روشن + بیومتریک در دسترس → قفل.
 *  - کلید روشن + بیومتریک در دسترس نیست → fail-open (هیچ‌وقت حبس نشوید).
 */
export function lockAtStart(env: LockEnv): boolean {
  return env.native && env.enabled && env.available;
}

/** تصمیم قفل هنگام پس‌زمینه رفتن اپ — failOpen یعنی این نشست اصلاً قفل نداریم */
export function lockOnBackground(state: LockState, env: LockEnv): boolean {
  return env.native && env.enabled && !state.failOpen && !state.locked;
}

/**
 * کاهش‌دهنده‌ی حالت — تنها نقطه‌ی تصمیم‌گیری؛ کاملاً قطعی و تست‌پذیر.
 */
export function reduceLock(state: LockState, event: LockEvent, env: LockEnv): LockState {
  switch (event.type) {
    case 'cold-start': {
      if (!env.native || !env.enabled) return state;
      if (!env.available) {
        return {
          ...state,
          locked: false,
          failOpen: true,
          attempts: 0,
          lastMessage: 'بیومتریک در دسترس نیست — قفل فعلاً اعمال نمی‌شود',
        };
      }
      return { ...state, locked: true, failOpen: false, attempts: 0, lastMessage: null };
    }

    case 'backgrounded': {
      if (!lockOnBackground(state, env)) return state;
      return { ...state, locked: true, attempts: 0, lastMessage: null };
    }

    case 'unlock-result': {
      if (!state.locked) return state;
      if (event.result === 'ok') {
        return { ...state, locked: false, failOpen: false, attempts: 0, lastMessage: null };
      }
      if (event.result === 'cancel') {
        return { ...state, locked: true, lastMessage: 'احراز هویت لغو شد — برای ورود دوباره تلاش کنید' };
      }
      if (event.result === 'fail') {
        return {
          ...state,
          locked: true,
          attempts: state.attempts + 1,
          lastMessage: event.message ?? 'احراز هویت ناموفق بود — دوباره تلاش کنید',
        };
      }
      // unavailable — باز شدن اضطراری: قفلی که با هیچ روشی باز نمی‌شود، حق حبس ندارد
      return {
        ...state,
        locked: false,
        failOpen: true,
        lastMessage: event.message ?? 'بیومتریک/رمز دستگاه در دسترس نیست — قفل موقتاً برداشته شد',
      };
    }

    case 'lock-disabled':
      return { ...initialLockState };
  }
}

/**
 * تفسیر کلید ذخیره‌شده در prefs — مهاجرت فاز ۳:
 * قبلاً این کلید فقط یک کلید نمایشی بی‌اثر با پیش‌فرض «روشن» بود؛ کاربری که هرگز
 * آن را لمس نکرده نباید ناگهان با قفل روبه‌رو شود. پس:
 *  - کلید اصلاً نبود (کاربر هرگز انتخابی نکرده) → خاموش (و در اولین ذخیره ثبت می‌شود)
 *  - کلید بود → همان مقدار (روشن فقط برای کسی که آگاهانه روشنش کرده بود)
 */
export function lockEnabledFromPref(raw: unknown | undefined): boolean {
  if (raw === undefined || raw === null) return false;
  return raw === true;
}
