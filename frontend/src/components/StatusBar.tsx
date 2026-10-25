import { Icon } from './Icon';

/** نوار وضعیت شبیه‌سازی‌شده‌ی بالای قاب موبایل (بخشی از طرح مرجع) */
export function StatusBar() {
  return (
    // فقط در قاب دسکتاپ — روی گوشی، نوار وضعیت واقعی خود دستگاه هست (ساعت/وای‌فای/آنتن)
    <div className="hidden sm:flex w-full h-8 pt-1.5 px-6 justify-between items-center text-[12px] font-semibold tracking-tight text-on-surface-variant dark:text-inverse-on-surface z-50 select-none shrink-0">
      <span className="font-bold">۹:۴۱</span>
      <div className="flex items-center gap-1.5">
        <Icon name="signal_cellular_4_bar" size={16} />
        <Icon name="wifi" size={16} />
        <Icon name="battery_full" size={18} />
      </div>
    </div>
  );
}
