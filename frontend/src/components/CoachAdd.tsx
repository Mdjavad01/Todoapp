import { Icon } from './Icon';
import { useAppStore } from '@/store/useAppStore';

/**
 * حباب راهنمای «اولین کار» (v10) — بالای دکمه‌ی + در صفحه‌ی خانه.
 * با زدن دکمه‌ی + یا بستن حباب، دیگر نمایش داده نمی‌شود (ماندگار در IndexedDB).
 */
export function CoachAdd() {
  const ready = useAppStore((s) => s.ready);
  const view = useAppStore((s) => s.view);
  const coachAdd = useAppStore((s) => s.coachAdd);
  const dismiss = useAppStore((s) => s.dismissCoachAdd);
  const openModal = useAppStore((s) => s.openModal);

  if (!ready || !coachAdd || view !== 'home') return null;

  return (
    <div className="absolute bottom-[196px] left-4 right-12 z-40" role="note" aria-label="راهنمای افزودن کار">
      <div
        className="relative bg-primary text-on-primary rounded-2xl p-3.5 shadow-xl fade-in cursor-pointer"
        onClick={() => openModal('quickAdd')}
      >
        <button
          className="absolute top-2 left-2 w-6 h-6 rounded-full bg-white/20 flex items-center justify-center active:scale-90 transition-transform"
          onClick={(e) => {
            e.stopPropagation();
            dismiss();
          }}
          aria-label="بستن راهنما"
        >
          <Icon name="close" size={13} />
        </button>
        <p className="text-label-lg font-bold">اولین کارت را همین‌جا اضافه کن!</p>
        <p className="text-body-sm opacity-90 mt-1 leading-relaxed">
          روی دکمه‌ی <b>+</b> بزن، اسم کار را بنویس و تمام — کارام سر موعدش یادت می‌آورد.
        </p>
      </div>
      {/* دُم حباب به سمت دکمه‌ی + */}
      <div className="absolute -bottom-1.5 left-9 w-4 h-4 bg-primary rotate-45 rounded-[3px]" aria-hidden="true" />
    </div>
  );
}
