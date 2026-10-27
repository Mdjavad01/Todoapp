import { useState } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import { useAppStore } from '@/store/useAppStore';

/** آیکن‌های پیشنهادی لیست — مشترک با شیت ویرایش لیست (فاز ۲) */
export const LIST_EMOJIS = ['🏠', '🛒', '📚', '📈', '💼', '💳', '🏋️', '✈️', '🎨', '🌸', '🍳', '🔧'];

/** مودال ساخت لیست جدید (دکمه‌ی «لیست جدید» در خانه) */
export function NewListSheet() {
  const modal = useAppStore((s) => s.modal);
  const openModal = useAppStore((s) => s.openModal);
  const createList = useAppStore((s) => s.createList);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🏠');

  const create = () => {
    if (!name.trim()) return;
    createList(name, emoji);
    setName('');
    setEmoji('🏠');
  };

  return (
    <Sheet open={modal === 'newList'} onClose={() => openModal(null)}>
      <SheetHeader title="لیست جدید" onClose={() => openModal(null)} />
      <input
        className="w-full bg-surface-container dark:bg-slate-800 border-0 rounded-2xl px-4 py-3 text-body-md text-on-surface dark:text-inverse-on-surface focus:ring-2 focus:ring-primary outline-none"
        placeholder="نام لیست (مثال: کارهای باغچه)"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && create()}
        aria-label="نام لیست"
        autoFocus
      />
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
      <button
        className="w-full py-3 bg-primary text-on-primary font-bold rounded-2xl shadow-md active:scale-95 text-body-md"
        onClick={create}
        disabled={!name.trim()}
      >
        ساخت لیست
      </button>
    </Sheet>
  );
}
