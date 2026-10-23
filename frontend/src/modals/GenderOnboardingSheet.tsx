import { useState } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import * as repo from '@/db/repo';
import { updateGender } from '@/sync/auth';

/**
 * آنبوردینگ انتخاب ظاهر (فاز ۴.۵) — بعد از اولین ورود نمایش داده می‌شود:
 * «دخترانه» = تم صورتی، «پسرانه» = تم فیروزه‌ای.
 * انتخاب روی پروفایل سرور ثبت و رنگ اپ همان‌جا اعمال می‌شود؛ بعداً از تنظیمات هم قابل تغییر است.
 */
export function GenderOnboardingSheet() {
  const open = useAppStore((s) => s.genderSheet);
  const session = useAppStore((s) => s.session);
  const setAccent = useAppStore((s) => s.setAccent);
  const showToast = useAppStore((s) => s.showToast);
  const [busy, setBusy] = useState<'male' | 'female' | null>(null);

  const onClose = () => useAppStore.setState({ genderSheet: false });

  const choose = async (g: 'male' | 'female') => {
    setBusy(g);
    try {
      setAccent(g === 'female' ? 'rose' : 'teal');
      await repo.prefsSet('gender-choice', g);
      if (session) {
        await updateGender(g);
      }
      showToast(g === 'female' ? 'تم صورتی فعال شد؛ خوش بدرخشید' : 'تم فیروزه‌ای فعال شد؛ خوش آمدید');
      onClose();
    } catch {
      showToast('ثبت انتخاب ناموفق بود؛ از تنظیمات دوباره امتحان کنید');
    } finally {
      setBusy(null);
    }
  };

  const skip = async () => {
    await repo.prefsSet('gender-choice', 'skipped');
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader title="ظاهر کارام را انتخاب کنید" onClose={onClose} />

      <p className="text-body-sm text-on-surface-variant leading-relaxed">
        دو تم آماده داریم؛ هر وقت خواستید از تنظیمات می‌توانید عوضش کنید.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {/* دخترانه — صورتی */}
        <button
          className={`relative overflow-hidden rounded-2xl border-2 p-4 text-right transition-all active:scale-95 ${
            busy === 'female' ? 'border-pink-500 bg-pink-50' : 'border-outline-variant/40 hover:border-pink-400'
          }`}
          onClick={() => void choose('female')}
          disabled={busy !== null}
          aria-label="تم دخترانه صورتی"
        >
          <div className="mb-3 flex h-16 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg, #fbcfe8 0%, #f472b6 100%)' }}>
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-white/80" />
              <span className="w-3 h-3 rounded-full bg-white/60" />
              <span className="w-3 h-3 rounded-full bg-white/40" />
            </div>
          </div>
          <p className="text-body-md font-bold">دخترانه</p>
          <p className="text-body-sm text-on-surface-variant mt-0.5">تم صورتی ملایم</p>
          {busy === 'female' ? (
            <span className="absolute top-2 left-2 w-5 h-5 rounded-full bg-pink-500 flex items-center justify-center">
              <Icon name="check" size={12} className="text-white" />
            </span>
          ) : null}
        </button>

        {/* پسرانه — فیروزه‌ای */}
        <button
          className={`relative overflow-hidden rounded-2xl border-2 p-4 text-right transition-all active:scale-95 ${
            busy === 'male' ? 'border-teal-600 bg-teal-50' : 'border-outline-variant/40 hover:border-teal-500'
          }`}
          onClick={() => void choose('male')}
          disabled={busy !== null}
          aria-label="تم پسرانه فیروزه‌ای"
        >
          <div className="mb-3 flex h-16 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg, #99f6e4 0%, #0d9488 100%)' }}>
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-white/80" />
              <span className="w-3 h-3 rounded-full bg-white/60" />
              <span className="w-3 h-3 rounded-full bg-white/40" />
            </div>
          </div>
          <p className="text-body-md font-bold">پسرانه</p>
          <p className="text-body-sm text-on-surface-variant mt-0.5">تم فیروزه‌ای کلاسیک</p>
          {busy === 'male' ? (
            <span className="absolute top-2 left-2 w-5 h-5 rounded-full bg-teal-600 flex items-center justify-center">
              <Icon name="check" size={12} className="text-white" />
            </span>
          ) : null}
        </button>
      </div>

      <button className="text-body-sm text-on-surface-variant font-bold self-center py-1" onClick={() => void skip()}>
        فعلاً بعداً انتخاب می‌کنم
      </button>
    </Sheet>
  );
}
