import { useEffect, useState } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/useAppStore';
import { LIST_EMOJIS } from '@/modals/NewListSheet';
import { defaultListId, LIST_BAR_COLORS } from '@/lib/selectors';
import type { ListColor } from '@/types';

const COLORS: { key: ListColor; label: string }[] = [
  { key: 'teal', label: 'فیروزه‌ای' },
  { key: 'amber', label: 'کهربایی' },
  { key: 'indigo', label: 'نیلی' },
  { key: 'emerald', label: 'زمردی' },
  { key: 'rose', label: 'صورتی' },
  { key: 'purple', label: 'بنفش' },
];

/**
 * شیت ویرایش لیست (فاز ۲) — نام/ایموجی/رنگ/گروه + کپی، جابه‌جایی و حذف با تأیید و واگرد.
 * لیست پیش‌فرض (اولین لیستِ ترتیب) حذف نمی‌شود — با یادداشت فارسی توضیح داده می‌شود.
 */
export function EditListSheet() {
  const modal = useAppStore((s) => s.modal);
  const openModal = useAppStore((s) => s.openModal);
  const editListId = useAppStore((s) => s.editListId);
  const lists = useAppStore((s) => s.lists);
  const groups = useAppStore((s) => s.groups);
  const updateList = useAppStore((s) => s.updateList);
  const deleteList = useAppStore((s) => s.deleteList);
  const copyList = useAppStore((s) => s.copyList);
  const moveList = useAppStore((s) => s.moveList);
  const setListGroup = useAppStore((s) => s.setListGroup);
  const addGroup = useAppStore((s) => s.addGroup);

  const list = lists.find((l) => l.id === editListId) ?? null;
  const isDefault = !!list && defaultListId(lists) === list.id;
  const currentGroup = list ? groups.find((g) => g.listIds.includes(list.id)) ?? null : null;

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🗂️');
  const [color, setColor] = useState<ListColor>('teal');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  // همگام‌سازی فیلدها با لیست هدف (باز شدن شیت / تعویض لیست)
  useEffect(() => {
    if (!list) return;
    setName(list.name);
    setEmoji(list.emoji);
    setColor(list.color);
    setGroupId(groups.find((g) => g.listIds.includes(list.id))?.id ?? null);
    setConfirmDelete(false);
    setCreatingGroup(false);
    setNewGroupName('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list?.id, modal]);

  if (modal !== 'editList' || !list) return null;

  const close = () => openModal(null);

  const save = async () => {
    if (!name.trim()) return;
    await updateList(list.id, { name, emoji, color });
    if (groupId !== (currentGroup?.id ?? null)) setListGroup(list.id, groupId);
    useAppStore.getState().showToast('تغییرات لیست ذخیره شد');
    close();
  };

  const createGroupAndSelect = () => {
    const clean = newGroupName.trim();
    if (!clean) return;
    const id = addGroup(clean);
    setGroupId(id);
    setCreatingGroup(false);
    setNewGroupName('');
  };

  return (
    <Sheet open={modal === 'editList'} onClose={close}>
      <SheetHeader title={`${list.emoji} ویرایش لیست`} onClose={close} />

      {/* نام */}
      <input
        className="w-full bg-surface-container dark:bg-slate-800 border-0 rounded-2xl px-4 py-3 text-body-md text-on-surface dark:text-inverse-on-surface focus:ring-2 focus:ring-primary outline-none"
        placeholder="نام لیست"
        type="text"
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        aria-label="نام لیست"
      />

      {/* ایموجی */}
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="آیکن لیست">
        {LIST_EMOJIS.map((e) => (
          <button
            key={e}
            className={`w-9 h-9 rounded-xl text-lg flex items-center justify-center transition-colors ${
              emoji === e ? 'bg-primary/20 ring-1 ring-primary' : 'bg-surface-container dark:bg-slate-800'
            }`}
            onClick={() => setEmoji(e)}
            role="radio"
            aria-checked={emoji === e}
          >
            {e}
          </button>
        ))}
      </div>

      {/* رنگ */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-outline font-semibold">رنگ لیست:</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="رنگ لیست">
          {COLORS.map((c) => (
            <button
              key={c.key}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 ${
                color === c.key
                  ? 'ring-2 ring-primary bg-primary/10 text-primary'
                  : 'bg-surface-container dark:bg-slate-800 text-on-surface-variant'
              }`}
              onClick={() => setColor(c.key)}
              role="radio"
              aria-checked={color === c.key}
            >
              <span className={`w-3.5 h-3.5 rounded-full ${LIST_BAR_COLORS[c.key]}`} aria-hidden="true" />
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* گروه */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-outline font-semibold">گروه (ترتیب نمایش در خانه):</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="گروه لیست">
          <button
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              groupId === null ? 'bg-primary text-on-primary' : 'bg-surface-container dark:bg-slate-800 text-on-surface-variant'
            }`}
            onClick={() => setGroupId(null)}
            role="radio"
            aria-checked={groupId === null}
          >
            بدون گروه
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                groupId === g.id ? 'bg-primary text-on-primary' : 'bg-surface-container dark:bg-slate-800 text-on-surface-variant'
              }`}
              onClick={() => setGroupId(g.id)}
              role="radio"
              aria-checked={groupId === g.id}
            >
              {g.name}
            </button>
          ))}
          {!creatingGroup ? (
            <button
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-primary/10 text-primary flex items-center gap-1"
              onClick={() => setCreatingGroup(true)}
            >
              <Icon name="add" size={14} />
              گروه جدید
            </button>
          ) : null}
        </div>
        {creatingGroup ? (
          <div className="flex gap-2">
            <input
              className="flex-1 bg-surface-container dark:bg-slate-800 border-0 rounded-xl px-3 py-2 text-body-sm outline-none focus:ring-2 focus:ring-primary text-on-surface dark:text-inverse-on-surface"
              placeholder="نام گروه (مثال: کار)"
              type="text"
              value={newGroupName}
              maxLength={60}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createGroupAndSelect()}
              aria-label="نام گروه جدید"
              autoFocus
            />
            <button className="px-3 rounded-xl bg-primary text-on-primary text-xs font-bold active:scale-95" onClick={createGroupAndSelect}>
              افزودن
            </button>
          </div>
        ) : null}
      </div>

      <button
        className="w-full py-3 bg-primary text-on-primary font-bold rounded-2xl shadow-md active:scale-95 text-body-md disabled:opacity-40"
        onClick={() => void save()}
        disabled={!name.trim()}
      >
        ذخیره تغییرات
      </button>

      {/* جابه‌جایی و کپی */}
      <div className="grid grid-cols-3 gap-2">
        <button
          className="py-2.5 bg-surface-container dark:bg-slate-800 rounded-xl text-xs font-bold text-on-surface flex items-center justify-center gap-1 active:scale-95 transition-transform"
          onClick={() => moveList(list.id, -1)}
        >
          <Icon name="arrow_upward" size={15} />
          بالا
        </button>
        <button
          className="py-2.5 bg-surface-container dark:bg-slate-800 rounded-xl text-xs font-bold text-on-surface flex items-center justify-center gap-1 active:scale-95 transition-transform"
          onClick={() => moveList(list.id, 1)}
        >
          <Icon name="arrow_downward" size={15} />
          پایین
        </button>
        <button
          className="py-2.5 bg-surface-container dark:bg-slate-800 rounded-xl text-xs font-bold text-on-surface flex items-center justify-center gap-1 active:scale-95 transition-transform"
          onClick={() => void copyList(list.id)}
        >
          <Icon name="content_copy" size={15} />
          کپی لیست
        </button>
      </div>

      {/* حذف با تأیید دو مرحله‌ای */}
      {confirmDelete ? (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-2xl p-3 flex flex-col gap-2">
          <p className="text-xs font-bold text-red-700 dark:text-red-300">
            حذف «{list.name}»؟ همه‌ی کارهای این لیست هم حذف می‌شوند — تا ۶ ثانیه دکمه‌ی واگرد را دارد.
          </p>
          <div className="flex gap-2">
            <button
              className="flex-1 py-2 bg-red-600 text-white rounded-xl text-xs font-bold active:scale-95 transition-transform"
              onClick={() => void deleteList(list.id)}
            >
              بله، حذف کن
            </button>
            <button
              className="flex-1 py-2 bg-surface-container dark:bg-slate-800 text-on-surface-variant rounded-xl text-xs font-bold active:scale-95 transition-transform"
              onClick={() => setConfirmDelete(false)}
            >
              انصراف
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <button
            className="w-full py-2.5 rounded-xl text-xs font-bold text-red-600 dark:text-red-400 flex items-center justify-center gap-1.5 bg-red-50 dark:bg-red-950/30 active:scale-[0.98] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => setConfirmDelete(true)}
            disabled={isDefault}
          >
            <Icon name="delete" size={15} />
            حذف لیست
          </button>
          {isDefault ? (
            <p className="text-[11px] text-on-surface-variant text-center">
              این لیست در صدر ترتیب است و هدف پیش‌فرض افزودن سریع کارهاست — برای حذف، ابتدا آن را با «بالا/پایین» از جای اول ببرید.
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
