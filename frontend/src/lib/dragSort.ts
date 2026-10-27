/**
 * کارام — ترتیب کشیدنی بدون وابستگی خارجی (فاز ۲)
 *
 * useDragSort: قلاب React با Pointer Events + دستگیره‌ی اختصاصی (بدون تداخل با اسکرول) + پشتیبانی کیبورد
 *   - کشیدن فقط از دستگیره شروع می‌شود (touch-action: none روی دستگیره)
 *   - حین کشیدن ترتیب محلی (order) به‌روز می‌شود و در پایان با onCommit نوشته می‌شود
 *   - کیبورد: فوکوس روی دستگیره + فلش بالا/پایین = جابه‌جایی و ثبت فوری
 *   - اسکرول خودکار وقتی اشاره‌گر به لبه‌ی بالایی/پایین‌صفحه نزدیک شود
 *
 * applySectionOrder: تابع خالص ادغام ترتیب تازه‌ی یک بخش در ترتیب سراسری (تست‌پذیر)
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** ادغام ترتیب تازه‌ی یک بخش داخل ترتیب سراسری — مواضع همان بخش با ترتیب تازه پر می‌شوند */
export function applySectionOrder(globalIds: string[], sectionIds: string[], nextOrder: string[]): string[] {
  const sectionSet = new Set(sectionIds);
  const nextSet = new Set(nextOrder);
  // دفاع: nextOrder باید همان عضوهای بخش باشد؛ وگرنه ترتیب سراسری دست‌نخورده می‌ماند
  if (sectionIds.length !== nextOrder.length || sectionIds.some((id) => !nextSet.has(id))) {
    return globalIds;
  }
  const merged: string[] = [];
  let k = 0;
  for (const id of globalIds) {
    merged.push(sectionSet.has(id) ? (nextOrder[k++] ?? id) : id);
  }
  return merged;
}

export interface DragSortApi {
  /** ترتیب جاری (حین کشیدن محلی، بعد از ثبت = همان ترتیب تازه) */
  order: string[];
  /** شناسه‌ی آیتم در حال کشیده‌شدن (برای استایل) */
  draggingId: string | null;
  /** ریف ریشه‌ی بخش — همه‌ی آیتم‌ها باید [data-drag-item] داشته باشند */
  containerRef: (el: HTMLElement | null) => void;
  /** ویژگی‌های دستگیره‌ی کشیدن هر آیتم */
  handleProps(id: string): {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    style: { touchAction: 'none' };
    role: 'button';
    'aria-label': string;
  };
  /** کلاس ظاهری آیتم حین کشیده‌شدن */
  itemClass(id: string): string;
  /** بعد از یک کشیدنِ واقعی، کلیکِ بعدی روی همان کارت نادیده گرفته می‌شود */
  shouldIgnoreClick(): boolean;
}

export function useDragSort(ids: string[], onCommit: (next: string[]) => void): DragSortApi {
  const [order, setOrder] = useState<string[]>(ids);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const container = useRef<HTMLElement | null>(null);
  const orderRef = useRef<string[]>(ids);
  const drag = useRef<{ id: string; index: number; moved: boolean } | null>(null);
  const scrollRaf = useRef<number>(0);
  const lastY = useRef<number>(0);
  const clickGuard = useRef(false);

  // همگام‌سازی با بیرون (فقط وقتی کشیدنی در جریان نیست)
  const idsKey = ids.join('\u0000');
  useEffect(() => {
    if (!drag.current) {
      orderRef.current = ids;
      setOrder(ids);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  useEffect(() => () => stopScroll(), []);

  function stopScroll(): void {
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = 0;
  }

  const tickScroll = useCallback(() => {
    const main = container.current?.closest('main');
    if (!main || !drag.current) {
      scrollRaf.current = 0;
      return;
    }
    const r = main.getBoundingClientRect();
    const margin = 64;
    let dy = 0;
    if (lastY.current < r.top + margin) dy = -10;
    else if (lastY.current > r.bottom - margin) dy = 10;
    if (dy !== 0) main.scrollTop += dy;
    scrollRaf.current = requestAnimationFrame(tickScroll);
  }, []);

  /** اندیس آیتمِ هدف بر اساس Y اشاره‌گر (وسط هر آیتم مرز است) */
  const findIndexAt = useCallback((y: number): number => {
    const el = container.current;
    if (!el) return -1;
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-drag-item]'));
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return items.length - 1;
  }, []);

  const move = useCallback(
    (from: number, to: number): void => {
      if (from === to || from < 0) return;
      const next = [...orderRef.current];
      if (to < 0 || to >= next.length) return;
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      orderRef.current = next;
      setOrder(next);
    },
    [],
  );

  const startDrag = useCallback(
    (id: string, e: React.PointerEvent): void => {
      if (e.button !== 0 || orderRef.current.length < 2) return;
      drag.current = { id, index: orderRef.current.indexOf(id), moved: false };
      lastY.current = e.clientY;
      setDraggingId(id);
      // گرفتن اشاره‌گر روی دستگیره: همه‌ی move/upها به همین المان می‌آیند (حتی بیرون صفحه)
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent): void => {
      if (!drag.current) return;
      lastY.current = e.clientY;
      const target = findIndexAt(e.clientY);
      if (target >= 0 && target !== drag.current.index) {
        move(drag.current.index, target);
        drag.current.index = target;
        drag.current.moved = true;
      }
      if (!scrollRaf.current) scrollRaf.current = requestAnimationFrame(tickScroll);
    },
    [findIndexAt, move, tickScroll],
  );

  const endDrag = useCallback((): void => {
    if (!drag.current) return;
    const moved = drag.current.moved;
    drag.current = null;
    stopScroll();
    setDraggingId(null);
    if (moved) {
      // یک کلیک ناخواسته بعد از کشیدن روی همان کارت باید نادیده گرفته شود
      clickGuard.current = true;
      window.setTimeout(() => {
        clickGuard.current = false;
      }, 350);
      onCommit(orderRef.current);
    }
  }, [onCommit]);

  const onKeyDown = useCallback(
    (id: string, e: React.KeyboardEvent): void => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const i = orderRef.current.indexOf(id);
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      const to = i + dir;
      if (i < 0 || to < 0 || to >= orderRef.current.length) return;
      move(i, to);
      onCommit(orderRef.current);
    },
    [move, onCommit],
  );

  return {
    order,
    draggingId,
    containerRef: (el: HTMLElement | null) => {
      container.current = el;
    },
    handleProps: (id: string) => ({
      onPointerDown: (e: React.PointerEvent) => startDrag(id, e),
      onPointerMove,
      onPointerUp: () => endDrag(),
      onPointerCancel: () => endDrag(),
      onKeyDown: (e: React.KeyboardEvent) => onKeyDown(id, e),
      style: { touchAction: 'none' as const },
      role: 'button' as const,
      'aria-label': 'کشیدن برای تغییر ترتیب',
    }),
    itemClass: (id: string) =>
      draggingId === id ? 'opacity-50 scale-[0.98] transition-none' : 'transition-transform duration-150',
    shouldIgnoreClick: () => clickGuard.current,
  };
}
