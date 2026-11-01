/**
 * کارام — دیالوگ‌ها و تولتیپ کارت پشتیبان‌گیری/بازیابی (P1.3)
 *
 *  - InfoPopover: آیکن «؟» با پاپ‌اوور کوچک — توضیح صادقانه‌ی «فایل چیست/کجا می‌رود/
 *    بازیابی چه می‌کند» (ممیزی P1.۳: قبلاً هیچ توضیحی نبود).
 *  - ConfirmRestoreDialog: پیش‌نمایش فایل انتخابی (تاریخ ساخت + شمارش) و تأیید
 *    قبل از اعمال — بازیابی هرگز بدون تأیید انجام نمی‌شود.
 *  - RestoreResultDialog: خلاصه‌ی ماندگار نتیجه (افزوده/به‌روزشده/محلی جدیدتر ماند)
 *    — نه فقط توست گذرا.
 *
 * لایه‌ی دیالوگ با Portal داخل قاب اپ (#appFrame) رندر می‌شود — همان جای
 * GuideSheet و بقیه‌ی شیت‌ها (absolute inset-0 داخل قاب ۴۱۰px، بدون خروج از قاب در دسکتاپ).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/Icon';
import { toFa } from '@/lib/format';
import { faJalaliDate } from '@/lib/jalali';
import { backupCountsOf, type BackupFile, type RestoreReport } from '@/lib/backup';

/* ---------- آیکن «؟» با پاپ‌اوور ---------- */

/** آیکن «؟» کنار هر بلوک — با کلیک، توضیح کوچک باز می‌شود؛ کلیک بیرون می‌بندد */
export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className="w-6 h-6 rounded-full bg-surface-container dark:bg-slate-700 flex items-center justify-center text-on-surface-variant hover:text-primary active:scale-90 transition-all"
      >
        <Icon name="help" size={15} />
      </button>
      {open ? (
        <div
          role="note"
          className="absolute top-8 end-0 w-[280px] max-w-[76vw] z-30 rounded-2xl border border-outline-variant/40 bg-surface-container-lowest dark:bg-slate-800 shadow-xl p-3.5 text-[12px] text-on-surface-variant leading-relaxed pop-in"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- لایه‌ی Portal داخل قاب اپ ---------- */

function PortalOverlay({ label, children, onBackdrop }: { label: string; children: ReactNode; onBackdrop?: () => void }) {
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setFrame(document.getElementById('appFrame'));
  }, []);

  useEffect(() => {
    if (!onBackdrop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBackdrop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBackdrop]);

  if (!frame) return null;
  return createPortal(
    <div
      className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-5 fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onBackdrop}
    >
      <div
        className="bg-surface dark:bg-slate-900 w-full max-w-[340px] rounded-[26px] shadow-2xl pop-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    frame,
  );
}

/* ---------- تاریخ ساخت فایل به شمسی ---------- */

function faDateOrUnknown(iso: string | undefined): string {
  if (!iso) return 'نامشخص';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'نامشخص';
  return faJalaliDate(d);
}

/* ---------- دیالوگ تأیید بازیابی ---------- */

export interface ConfirmRestoreProps {
  fileName: string;
  preview: BackupFile;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmRestoreDialog({ fileName, preview, busy, onCancel, onConfirm }: ConfirmRestoreProps) {
  const c = backupCountsOf(preview);
  return (
    <PortalOverlay label="تأیید بازیابی از فایل" onBackdrop={busy ? undefined : onCancel}>
      <div className="p-5 flex flex-col gap-3" data-testid="restore-confirm">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon name="refresh" size={24} />
          </div>
          <div className="min-w-0">
            <h3 className="text-headline-sm font-black text-on-surface dark:text-inverse-on-surface">بازیابی از فایل</h3>
            <p className="text-[11px] text-on-surface-variant truncate" dir="ltr" title={fileName}>
              {fileName}
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-surface-container dark:bg-slate-800 p-3.5 flex flex-col gap-1.5 text-body-sm">
          <div className="flex justify-between gap-2">
            <span className="text-on-surface-variant">تاریخ ساخت فایل</span>
            <span className="font-bold">{faDateOrUnknown(preview.exportedAt)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-on-surface-variant">محتوای فایل</span>
            <span className="font-bold">
              {toFa(c.lists)} لیست · {toFa(c.tasks)} کار
              <br />
              {toFa(c.subtasks)} زیرکار · {toFa(c.reminders)} یادآور
            </span>
          </div>
        </div>

        <p className="text-body-sm text-on-surface-variant leading-relaxed flex items-start gap-1.5">
          <Icon name="verified" size={16} className="text-primary mt-0.5 shrink-0" />
          <span>
            محتوای فایل با داده‌های فعلی شما <b className="text-on-surface dark:text-inverse-on-surface">ادغام</b> می‌شود
            (جدیدترین نسخه‌ی هر مورد می‌ماند) و <b className="text-on-surface dark:text-inverse-on-surface">هیچ‌چیز حذف نمی‌شود</b>.
          </span>
        </p>

        <div className="flex gap-2 pt-1">
          <button
            className="flex-1 py-3 rounded-2xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform disabled:opacity-50"
            onClick={onConfirm}
            disabled={busy}
            aria-label="تأیید بازیابی"
          >
            {busy ? 'در حال بازیابی…' : 'بازیابی'}
          </button>
          <button
            className="flex-1 py-3 rounded-2xl bg-surface-container text-on-surface font-bold text-body-sm active:scale-95 transition-transform disabled:opacity-50"
            onClick={onCancel}
            disabled={busy}
            aria-label="انصراف از بازیابی"
          >
            انصراف
          </button>
        </div>
      </div>
    </PortalOverlay>
  );
}

/* ---------- دیالوگ نتیجه‌ی بازیابی (ماندگار، نه توست) ---------- */

export interface RestoreResultProps {
  fileName: string;
  report: RestoreReport;
  /** اگر حساب ابری فعال باشد بعد از بازیابی به سرور هم سینک می‌شود */
  willSync: boolean;
  onClose: () => void;
}

export function RestoreResultDialog({ fileName, report, willSync, onClose }: RestoreResultProps) {
  const rows: { label: string; value: number; icon: 'add' | 'refresh' | 'shield' }[] = [
    { label: 'افزوده شد (در این دستگاه نبود)', value: report.added, icon: 'add' },
    { label: 'به‌روز شد (نسخه‌ی فایل جدیدتر بود)', value: report.updated, icon: 'refresh' },
    { label: 'محلی جدیدتر ماند (دست نخورد)', value: report.kept, icon: 'shield' },
  ];
  return (
    <PortalOverlay label="نتیجه‌ی بازیابی" onBackdrop={onClose}>
      <div className="p-5 flex flex-col gap-3" data-testid="restore-result">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Icon name="check_circle" size={24} />
          </div>
          <div className="min-w-0">
            <h3 className="text-headline-sm font-black text-on-surface dark:text-inverse-on-surface">بازیابی انجام شد</h3>
            <p className="text-[11px] text-on-surface-variant truncate" dir="ltr" title={fileName}>
              {fileName}
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-surface-container dark:bg-slate-800 p-3.5 flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-2 text-body-sm">
              <span className="flex items-center gap-2 text-on-surface-variant">
                <Icon name={r.icon} size={15} className="text-outline shrink-0" />
                {r.label}
              </span>
              <span className="font-black">{toFa(r.value)}</span>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-on-surface-variant leading-relaxed">
          هیچ‌چیز از داده‌های فعلی حذف نشده است.
          {willSync ? ' اگر وارد حساب شده باشید، داده‌های بازیابی‌شده به‌زودی با فضای ابری همگام می‌شود.' : ''}
        </p>

        <button
          className="w-full py-3 rounded-2xl bg-primary text-on-primary font-bold text-body-sm active:scale-95 transition-transform"
          onClick={onClose}
          aria-label="بستن نتیجه‌ی بازیابی"
        >
          متوجه شدم
        </button>
      </div>
    </PortalOverlay>
  );
}
