/**
 * کارام — جبران اختلاف ساعت دستگاه با سرور (ترمیم جریان — فاز ۱)
 *
 * سرور در هر پاسخ سینک «serverTime» رسمی خودش را می‌فرستد.
 * اگر اختلاف معنادار باشد (≥۵ ثانیه — زیر آن نویز شبکه است)، آفست ذخیره می‌شود
 * و nowIso() زمانِ هم‌ترازِ سرور تولید می‌کند تا updatedAtها در LWW قابل‌اعتماد باشند.
 * سقف جبران ±۲۴ ساعت تا آفستِ مضحک، داده را جابه‌جا نکند.
 */

let offsetMs = 0;

/** به‌روزرسانی آفست از serverTime پاسخ سینک — true یعنی آفست تغییر کرد */
export function setClockOffset(serverIso: string | null | undefined): boolean {
  if (!serverIso) return false;
  const t = Date.parse(serverIso);
  if (Number.isNaN(t)) return false;
  const off = t - Date.now();
  if (Math.abs(off) < 5_000) {
    offsetMs = 0;
    return false;
  }
  const clamped = Math.max(-86_400_000, Math.min(86_400_000, off));
  if (clamped === offsetMs) return false;
  offsetMs = clamped;
  return true;
}

export function getClockOffsetMs(): number {
  return offsetMs;
}

/** فقط برای تست‌ها */
export function resetClockOffset(): void {
  offsetMs = 0;
}
