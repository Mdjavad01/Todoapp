/**
 * کارام — پنل مدیریت: اجزای مشترک UI
 * نکته‌ی CSP: به‌جای style={{}} (که CSP آن را می‌بندد) از CSSOM استفاده می‌شود.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { faNum } from './format';
import { IconClose, IconWarning } from './icons';

/* ---------------- نوار درصد (CSSOM — سازگار با CSP) ---------------- */
export function Bar({ percent, tone = 'brand' }: { percent: number; tone?: 'brand' | 'rose' | 'amber' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.setProperty('--w', `${Math.min(100, Math.max(0, percent))}%`);
    }
  }, [percent]);
  const toneCls = tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-brand-500';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={Math.round(percent)}>
      <div ref={ref} className={`h-full rounded-full ${toneCls}`} />
    </div>
  );
}

/* ---------------- نشان ---------------- */
export function Badge({ tone, children }: { tone: 'green' | 'red' | 'gray' | 'amber' | 'brand'; children: ReactNode }) {
  const tones: Record<string, string> = {
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    red: 'bg-rose-50 text-rose-700 ring-rose-600/20',
    gray: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    brand: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

/* ---------------- مودال ---------------- */
export function Modal({
  open,
  title,
  onClose,
  children,
  width = 'max-w-lg',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div className={`relative w-full ${width} rounded-2xl bg-white shadow-pop`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          <button type="button" className="btn-ghost !p-1.5" onClick={onClose} aria-label="بستن">
            <IconClose size={18} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- توست ---------------- */
type ToastKind = 'success' | 'error';
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function useToast(): { toast: ToastState | null; show: (kind: ToastKind, text: string) => void } {
  const [toast, setToast] = useState<ToastState | null>(null);
  const show = (kind: ToastKind, text: string) => {
    if (toastTimer) clearTimeout(toastTimer);
    setToast({ kind, text });
    toastTimer = setTimeout(() => setToast(null), 3500);
  };
  return { toast, show };
}

export interface ToastState {
  kind: ToastKind;
  text: string;
}

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2" role="status" aria-live="polite">
      <div
        className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-pop ${
          toast.kind === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
        }`}
      >
        {toast.kind === 'error' ? <IconWarning size={18} /> : <IconCheckDot />}
        {toast.text}
      </div>
    </div>
  );
}

function IconCheckDot() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/* ---------------- بارگذاری ---------------- */
export function Spinner({ label = 'در حال بارگذاری…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-14 text-slate-500" role="status">
      <svg className="h-6 w-6 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
      </svg>
      <span className="text-sm">{label}</span>
    </div>
  );
}

/* ---------------- صفحه‌بندی ---------------- */
export function Pagination({
  page,
  pages,
  total,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  onChange: (p: number) => void;
}) {
  if (pages <= 1) return <p className="px-3 py-2 text-xs text-slate-400">مجموع: {faNum(total)}</p>;
  const windowPages: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p++) windowPages.push(p);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
      <p className="text-xs text-slate-400">
        صفحه {faNum(page)} از {faNum(pages)} — مجموع {faNum(total)}
      </p>
      <div className="flex items-center gap-1">
        <button type="button" className="btn-ghost !px-2 text-xs" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          قبلی
        </button>
        {windowPages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={`h-8 min-w-8 rounded-lg px-2 text-xs font-medium transition-colors ${
              p === page ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {faNum(p)}
          </button>
        ))}
        <button type="button" className="btn-ghost !px-2 text-xs" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          بعدی
        </button>
      </div>
    </div>
  );
}

/* ---------------- وضعیت خالی ---------------- */
export function EmptyState({ text }: { text: string }) {
  return <p className="px-4 py-12 text-center text-sm text-slate-400">{text}</p>;
}
