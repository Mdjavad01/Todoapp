import { ReactNode, useEffect } from 'react';
import { Icon } from './Icon';

/** پوسته‌ی بات‌شیت مطابق طرح — backdrop تار + گردی ۳۲px بالا */
interface SheetProps {
  open: boolean;
  onClose(): void;
  children: ReactNode;
  maxHeight?: string;
}

export function Sheet({ open, onClose, children, maxHeight = '88%' }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    // مکانیزم جهانی کیبورد (v15): padding-bottom = ارتفاع کیبورد → شیت همیشه
    // بالای کیبورد می‌نشیند و فرم زیر کیبورد گم نمی‌شود (متغیر در lib/keyboard.ts)
    <div
      className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col justify-end fade-in"
      style={{ paddingBottom: 'var(--kb-height, 0px)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-surface dark:bg-slate-900 w-full rounded-t-[32px] p-5 flex flex-col gap-4 shadow-2xl sheet-in overflow-y-auto no-scrollbar"
        style={{ maxHeight: `calc(${maxHeight} - var(--kb-height, 0px))` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-1 bg-outline-variant rounded-full mx-auto mb-1" />
        {children}
      </div>
    </div>
  );
}

/** سربرگ شیت با دکمه‌ی بستن */
export function SheetHeader({ title, onClose }: { title: ReactNode; onClose(): void }) {
  return (
    <div className="flex justify-between items-center">
      <h3 className="text-headline-md font-bold text-on-surface dark:text-inverse-on-surface">{title}</h3>
      <button
        className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container active:scale-95 transition-all"
        onClick={onClose}
        aria-label="بستن"
      >
        <Icon name="close" size={24} />
      </button>
    </div>
  );
}

/** دکمه‌ی میکروفون غیرفعال (سرویس وویس در فاز بعدی اضافه می‌شود) */
export function MicButton({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center opacity-40 cursor-not-allowed ${className}`}
      title="ورودی صوتی به‌زودی فعال می‌شود"
      aria-disabled="true"
    >
      <Icon name="mic" size={size} />
    </span>
  );
}
