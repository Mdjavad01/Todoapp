import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { fetchActiveAnnouncements, type ActiveAnnouncement } from '@/sync/announcements';

/**
 * بنر تبلیغ/اطلاعیه صفحه‌ی خانه (فاز ۹ — نیاز ۱۱)
 *  - اطلاعیه‌ی فعال از سرور می‌آید؛ محتوا کاملاً از پنل ادمین کنترل می‌شود
 *  - بستن با X تا پایان روز (به‌ازای هر اطلاعیه) — فردا دوباره نمایش داده می‌شود
 *  - تصویر/GIF فقط از همین دامنه رندر می‌شود (CSP فقط 'self' است)
 *  - لینک دکمه‌ی «مشاهده» در تب جدید باز می‌شود
 */

const DISMISS_KEY = 'karam-ann-dismissed';

type AnnType = 'info' | 'warning' | 'premium';

const STYLE: Record<AnnType, { box: string; iconWrap: string; icon: 'notifications_active' | 'warning' | 'workspace_premium'; cta: string }> = {
  info: {
    box: 'bg-primary/10 border-primary/25',
    iconWrap: 'bg-primary/15 text-primary',
    icon: 'notifications_active',
    cta: 'bg-primary text-on-primary',
  },
  warning: {
    box: 'bg-amber-50 border-amber-300/50 dark:bg-amber-950/40 dark:border-amber-500/30',
    iconWrap: 'bg-amber-100 text-amber-600 dark:bg-amber-900/60 dark:text-amber-300',
    icon: 'warning',
    cta: 'bg-amber-500 text-white',
  },
  premium: {
    box: 'bg-gradient-to-l from-amber-400/25 to-amber-200/10 border-amber-300/50 dark:from-amber-500/20 dark:to-amber-400/5 dark:border-amber-400/30',
    iconWrap: 'bg-amber-100 text-amber-600 dark:bg-amber-900/60 dark:text-amber-300',
    icon: 'workspace_premium',
    cta: 'bg-amber-500 text-white',
  },
};

/** تصویر فقط از همین دامنه — چون CSP اجازه‌ی img خارجی نمی‌دهد */
function sameOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

function readDismissed(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function AdBanner() {
  const [item, setItem] = useState<ActiveAnnouncement | null>(null);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    let alive = true;
    fetchActiveAnnouncements()
      .then((items) => {
        if (!alive || !Array.isArray(items) || items.length === 0) return;
        const dismissed = readDismissed();
        const today = todayKey();
        const first = items.find((a) => dismissed[a.uuid] !== today);
        if (first) setItem(first);
      })
      .catch(() => {
        /* آفلاین/خطا — بدون بنر */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!item) return null;

  const style = STYLE[item.type as AnnType] ?? STYLE.info;
  const img = item.imageUrl && sameOrigin(item.imageUrl) ? item.imageUrl : null;

  const dismiss = () => {
    try {
      const dismissed = readDismissed();
      dismissed[item.uuid] = todayKey();
      // بیش از ۲۰ رکورد قدیمی پاک نمی‌ماند
      const keys = Object.keys(dismissed);
      if (keys.length > 20) delete dismissed[keys[0]];
      localStorage.setItem(DISMISS_KEY, JSON.stringify(dismissed));
    } catch {
      /* بی‌اهمیت */
    }
    setItem(null);
  };

  const openLink = () => {
    if (!item.linkUrl) return;
    window.open(item.linkUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className={`rounded-2xl border p-3.5 relative overflow-hidden ${style.box}`}
      role="region"
      aria-label="اطلاعیه و تبلیغ کارام"
    >
      <button
        type="button"
        onClick={dismiss}
        className="absolute top-2 left-2 w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant/70 hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all"
        aria-label="بستن اطلاعیه"
      >
        <Icon name="close" size={16} />
      </button>

      {img ? (
        <img
          src={img}
          alt={item.title}
          className="w-full h-28 object-cover rounded-xl mb-2.5"
          loading="lazy"
        />
      ) : null}

      <div className="flex items-start gap-2.5">
        <span className={`inline-flex p-1.5 rounded-lg shrink-0 ${style.iconWrap}`}>
          <Icon name={style.icon} size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-body-sm font-black text-on-surface dark:text-inverse-on-surface pr-4">{item.title}</p>
          <p className="text-[11px] text-on-surface-variant leading-5 mt-0.5 whitespace-pre-line">{item.body}</p>
          {item.linkUrl ? (
            <button
              type="button"
              onClick={openLink}
              className={`mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-bold active:scale-95 transition-transform ${style.cta}`}
            >
              مشاهده
              <Icon name="arrow_back" size={14} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
