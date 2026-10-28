import { useState } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { defaultListId, HUB_CARDS } from '@/lib/selectors';

/** کلید ردیف قابل‌کلیک */
function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${on ? 'bg-primary' : 'bg-outline-variant/60 dark:bg-slate-600'}`}
      onClick={() => onChange(!on)}
    >
      <span
        className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200"
        style={{ right: on ? '2px' : 'calc(100% - 22px)' }}
      />
    </button>
  );
}

/**
 * شیت مدیریت لیست‌ها (فاز ۲) — کلید نمایش لیست‌های هوشمند خانه + مدیریت گروه‌ها
 * + ردیف لیست‌ها با جابه‌جایی بالا/پایین (جایگزین دسترس‌پذیر کشیدن) و ورود به ویرایش هر لیست.
 */
export function ManageListsSheet() {
  const modal = useAppStore((s) => s.modal);
  const openModal = useAppStore((s) => s.openModal);
  const lists = useAppStore((s) => s.lists);
  const groups = useAppStore((s) => s.groups);
  const hubHidden = useAppStore((s) => s.hubHidden);
  const setHubHidden = useAppStore((s) => s.setHubHidden);
  const openEditList = useAppStore((s) => s.openEditList);
  const moveList = useAppStore((s) => s.moveList);
  const addGroup = useAppStore((s) => s.addGroup);
  const renameGroup = useAppStore((s) => s.renameGroup);
  const deleteGroup = useAppStore((s) => s.deleteGroup);
  const sorted = [...lists]; // lists از استور همیشه با ترتیب قطعی می‌آید
  const defId = defaultListId(lists);

  const [newGroupName, setNewGroupName] = useState('');
  const [addingGroup, setAddingGroup] = useState(false);

  const close = () => openModal(null);
  const open = modal === 'manageLists';
  if (!open) return null;

  const add = () => {
    if (!newGroupName.trim()) return;
    addGroup(newGroupName);
    setNewGroupName('');
    setAddingGroup(false);
  };

  return (
    <Sheet open={open} onClose={close}>
      <SheetHeader title="مدیریت لیست‌ها" onClose={close} />

      {/* لیست‌های هوشمند خانه */}
      <div className="flex flex-col gap-2">
        <h4 className="text-label-md font-bold text-on-surface-variant flex items-center gap-1.5">
          <Icon name="auto_awesome" size={16} />
          لیست‌های هوشمند خانه
        </h4>
        <div className="bg-surface-container-low dark:bg-slate-800/60 rounded-2xl divide-y divide-outline-variant/20 overflow-hidden">
          {HUB_CARDS.map((h) => {
            const hidden = hubHidden.includes(h.key);
            return (
              <div key={h.key} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-body-sm font-semibold text-on-surface dark:text-inverse-on-surface">{h.label}</span>
                <Switch
                  on={!hidden}
                  label={`${h.label} در خانه نمایش داده شود`}
                  onChange={(v) => setHubHidden(h.key, !v)}
                />
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-on-surface-variant">ردیف‌های بالای خانه — هر کدام را نخواهید، خاموش کنید.</p>
      </div>

      {/* گروه‌ها */}
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <h4 className="text-label-md font-bold text-on-surface-variant flex items-center gap-1.5">
            <Icon name="folder" size={16} />
            گروه‌های لیست‌ها
          </h4>
          {!addingGroup ? (
            <button
              className="text-xs font-bold text-primary flex items-center gap-0.5"
              onClick={() => setAddingGroup(true)}
            >
              <Icon name="add" size={15} />
              گروه جدید
            </button>
          ) : null}
        </div>
        {groups.length > 0 ? (
          <div className="bg-surface-container-low dark:bg-slate-800/60 rounded-2xl divide-y divide-outline-variant/20 overflow-hidden">
            {groups.map((g) => (
              <div key={g.id} className="flex items-center gap-2 px-3 py-2">
                <input
                  className="flex-1 bg-transparent border-0 text-body-sm font-semibold text-on-surface dark:text-inverse-on-surface outline-none focus:ring-0 min-w-0"
                  defaultValue={g.name}
                  maxLength={60}
                  aria-label={`نام گروه ${g.name}`}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value.trim() !== g.name) renameGroup(g.id, e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
                <span className="text-[11px] text-on-surface-variant shrink-0">{g.listIds.length} لیست</span>
                <button
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-red-600 shrink-0"
                  onClick={() => deleteGroup(g.id)}
                  aria-label={`حذف گروه ${g.name}`}
                  title="حذف گروه (لیست‌ها حذف نمی‌شوند)"
                >
                  <Icon name="delete" size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-on-surface-variant">هنوز گروهی ندارید — گروه‌ها لیست‌های خانه را دسته‌بندی می‌کنند.</p>
        )}
        {addingGroup ? (
          <div className="flex gap-2">
            <input
              className="flex-1 bg-surface-container dark:bg-slate-800 border-0 rounded-xl px-3 py-2 text-body-sm outline-none focus:ring-2 focus:ring-primary text-on-surface dark:text-inverse-on-surface"
              placeholder="نام گروه (مثال: شخصی، کاری)"
              type="text"
              value={newGroupName}
              maxLength={60}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              aria-label="نام گروه جدید"
              autoFocus
            />
            <button className="px-3 rounded-xl bg-primary text-on-primary text-xs font-bold active:scale-95" onClick={add}>
              افزودن
            </button>
            <button
              className="px-3 rounded-xl bg-surface-container dark:bg-slate-800 text-on-surface-variant text-xs font-bold active:scale-95"
              onClick={() => {
                setAddingGroup(false);
                setNewGroupName('');
              }}
            >
              لغو
            </button>
          </div>
        ) : null}
      </div>

      {/* ردیف لیست‌ها: ترتیب + ویرایش */}
      <div className="flex flex-col gap-2">
        <h4 className="text-label-md font-bold text-on-surface-variant flex items-center gap-1.5">
          <Icon name="sort" size={16} />
          لیست‌ها ({sorted.length})
        </h4>
        <div className="bg-surface-container-low dark:bg-slate-800/60 rounded-2xl divide-y divide-outline-variant/20 overflow-hidden">
          {sorted.map((l, i) => (
            <div key={l.id} className="flex items-center gap-1 px-2 py-1.5">
              <button
                className="flex-1 flex items-center gap-2 px-1.5 py-1.5 rounded-xl text-right min-w-0 hover:bg-white/40 dark:hover:bg-white/5 transition-colors"
                onClick={() => openEditList(l.id)}
                aria-label={`ویرایش لیست ${l.name}`}
              >
                <span className="text-lg shrink-0">{l.emoji}</span>
                <span className="text-body-sm font-semibold text-on-surface dark:text-inverse-on-surface truncate">{l.name}</span>
                {l.id === defId ? (
                  <span className="text-[10px] font-bold bg-primary/15 text-primary px-1.5 py-0.5 rounded-full shrink-0">پیش‌فرض</span>
                ) : null}
              </button>
              <button
                className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-primary active:scale-90 transition-transform disabled:opacity-30 shrink-0"
                onClick={() => moveList(l.id, -1)}
                disabled={i === 0}
                aria-label={`انتقال ${l.name} به بالا`}
              >
                <Icon name="arrow_upward" size={16} />
              </button>
              <button
                className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-primary active:scale-90 transition-transform disabled:opacity-30 shrink-0"
                onClick={() => moveList(l.id, 1)}
                disabled={i === sorted.length - 1}
                aria-label={`انتقال ${l.name} به پایین`}
              >
                <Icon name="arrow_downward" size={16} />
              </button>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-on-surface-variant">
          ضربه = ویرایش (نام، آیکن، رنگ، گروه، حذف و کپی) — فلش‌ها = جابه‌جایی ترتیب.
        </p>
      </div>
    </Sheet>
  );
}
