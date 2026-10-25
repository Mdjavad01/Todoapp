import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { toFa } from '@/lib/format';

/** گام‌های تور — سلکتورِ المان واقعی + جهت توولتیپ (v12)؛ sel=null یعنی گام پایانی وسط صفحه */
interface TourStep {
  sel: string | null;
  place: 'top' | 'bottom';
  title: string;
  text: string;
}

const STEPS: TourStep[] = [
  {
    sel: '[aria-label="سوییچ تم روز/شب"]',
    place: 'bottom',
    title: 'شب و روز با یک ضربه',
    text: 'با این دکمه اپ را به حالت شب یا روز ببرید؛ همه‌ی رنگ‌ها هم‌زمان عوض می‌شوند. کنارش جستجو و تقویم شمسی هم هست.',
  },
  {
    sel: '[aria-label="جستجو"]',
    place: 'bottom',
    title: 'جستجوی سریع',
    text: 'بین همه‌ی کارها و لیست‌هایتان بگردید؛ هر کلمه‌ای که یادتان باشد را همین‌جا تایپ کنید تا پیدایش کند.',
  },
  {
    sel: '[aria-label="تقویم شمسی"]',
    place: 'bottom',
    title: 'تقویم شمسی',
    text: 'تاریخ امروز را شمسی ببینید و برای کارهایتان روزِ دقیق انتخاب کنید؛ کافی است روی همین آیکن بزنید.',
  },
  {
    sel: '[aria-label="افزودن کار جدید"]',
    place: 'top',
    title: 'قلب کارام همین‌جاست',
    text: 'دکمه‌ی سبز + را بزنید تا کار جدید اضافه کنید؛ تاریخ و ساعت را هم می‌توانید تعیین کنید تا اپ یادتان بیندازد.',
  },
  {
    sel: 'nav[aria-label="ناوبری اصلی"]',
    place: 'top',
    title: 'چهار بخش اصلی',
    text: 'خانه، امروز، آمار و تنظیمات — همه‌چیز از همین نوار پایین در دسترس است؛ همین حالا هم اینجا هستید.',
  },
  {
    sel: null,
    place: 'top',
    title: 'همه‌چیز آماده است! 🎉',
    text: 'حالا کارام را می‌شناسید. اولین کارتان را با دکمه‌ی + اضافه کنید و بقیه را به دستیار هوشمندتان بسپارید. هر وقت راهنما خواستید، در تنظیمات در دسترس است.',
  },
];

const TIP_W = 286; // پهنای توولتیپ
const SPOT_PAD = 10; // فاصله‌ی اسپات‌لایت از لبه‌ی المان

/** تور تعاملی کارام (v12) — اسپات‌لایت نورانی دور المان واقعی + توولتیپ گام‌به‌گام با انیمیشن نرم */
export function TourOverlay() {
  const open = useAppStore((s) => s.tourOpen);
  const close = () => useAppStore.setState({ tourOpen: false });
  const [idx, setIdx] = useState(0);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [frame, setFrame] = useState({ w: 410, h: 800 });
  const [tipH, setTipH] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const measure = () => {
    const root = rootRef.current;
    const fr = root?.parentElement?.getBoundingClientRect();
    if (!fr) return;
    setFrame((p) => (p.w === fr.width && p.h === fr.height ? p : { w: fr.width, h: fr.height }));
    const st = STEPS[idx];
    if (!st.sel) {
      setBox(null);
      return;
    }
    const el = document.querySelector(st.sel);
    if (!el) {
      setBox(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setBox({ x: r.left - fr.left, y: r.top - fr.top, w: r.width, h: r.height });
  };

  // ریست به گام اول در هر باز شدن
  useEffect(() => {
    if (open) setIdx(0);
  }, [open]);

  // بستن با Escape + محاسبه‌ی مجدد هنگام تغییر اندازه‌ی پنجره
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onResize = () => measure();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idx]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    if (tipRef.current) setTipH(tipRef.current.offsetHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idx, frame.w, frame.h]);

  if (!open) return null;

  const step = STEPS[idx];
  const isFinish = step.sel === null;

  // جای‌گذاری توولتیپ نسبت به المان هدف (داخل قاب موبایل)
  let tipLeft = frame.w / 2 - TIP_W / 2;
  let tipTop = frame.h / 2 - tipH / 2;
  let arrowLeft = TIP_W / 2 - 6;
  let arrowSide: 'top' | 'bottom' = 'bottom';
  if (box) {
    tipLeft = Math.max(12, Math.min(box.x + box.w / 2 - TIP_W / 2, frame.w - TIP_W - 12));
    arrowLeft = Math.max(18, Math.min(box.x + box.w / 2 - tipLeft - 6, TIP_W - 30));
    if (step.place === 'bottom') {
      tipTop = box.y + box.h + SPOT_PAD + 10;
      arrowSide = 'top';
    } else {
      tipTop = box.y - SPOT_PAD - tipH - 10;
      arrowSide = 'bottom';
    }
    tipTop = Math.max(12, Math.min(tipTop, frame.h - tipH - 12));
  }

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-[60]"
      role="dialog"
      aria-modal="true"
      aria-label="تور آموزشی کارام"
    >
      {/* اسپات‌لایت: قابِ نورانی دور المان + تاریکی همه‌جا با box-shadow — بین گام‌ها نرم جابه‌جا می‌شود */}
      {box ? (
        <div
          className="absolute rounded-2xl border-2 border-white/70 transition-all duration-300 ease-out"
          style={{
            left: box.x - SPOT_PAD,
            top: box.y - SPOT_PAD,
            width: box.w + SPOT_PAD * 2,
            height: box.h + SPOT_PAD * 2,
            boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.74)',
          }}
        />
      ) : (
        <div className="absolute inset-0 fade-in" style={{ background: 'rgba(2, 6, 23, 0.74)' }} />
      )}

      {/* توولتیپ گام */}
      <div
        ref={tipRef}
        className="absolute bg-surface dark:bg-slate-800 rounded-2xl shadow-2xl p-4 transition-all duration-300 ease-out pop-in"
        style={{ left: tipLeft, top: tipTop, width: TIP_W }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* دُم توولتیپ رو به المان */}
        {box ? (
          <div
            className={`absolute w-3 h-3 rotate-45 bg-surface dark:bg-slate-800 ${arrowSide === 'top' ? '-top-1.5' : '-bottom-1.5'}`}
            style={{ left: arrowLeft }}
          />
        ) : null}

        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-black text-primary bg-primary/10 rounded-full px-2.5 py-1">
            {isFinish ? 'پایان تور' : `گام ${toFa(idx + 1)} از ${toFa(STEPS.length - 1)}`}
          </span>
          <button
            className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container dark:hover:bg-slate-700 active:scale-95 transition-all"
            onClick={close}
            aria-label="بستن تور"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <h4 className="text-headline-sm font-black text-on-surface dark:text-inverse-on-surface">{step.title}</h4>
        <p className="text-body-sm text-on-surface-variant leading-relaxed mt-1">{step.text}</p>

        {/* نقطه‌های پیشرفت */}
        <div className="flex items-center justify-center gap-1.5 mt-3 mb-3">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === idx ? 'w-5 bg-primary' : 'w-1.5 bg-outline-variant'}`}
            />
          ))}
        </div>

        <div className="flex gap-2">
          {idx > 0 && !isFinish ? (
            <button
              className="flex-1 py-2.5 rounded-xl bg-surface-container text-on-surface font-bold text-body-sm active:scale-95 transition-transform"
              onClick={() => setIdx(idx - 1)}
            >
              قبلی
            </button>
          ) : null}
          <button
            className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform flex items-center justify-center gap-1.5"
            onClick={() => (isFinish ? close() : setIdx(idx + 1))}
          >
            {isFinish ? (
              <>
                شروع به کار با کارام
                <Icon name="check" size={17} />
              </>
            ) : (
              <>
                بعدی
                <Icon name="arrow_back_ios" size={12} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
