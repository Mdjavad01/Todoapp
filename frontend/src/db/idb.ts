/**
 * پوشش سبک IndexedDB — بدون هیچ وابستگی خارجی.
 * پایگاه‌داده‌ی محلی حالت مهمان؛ کاملاً آفلاین.
 * مهاجرت نسخه‌دار (فاز ۲): هر گام نسخه در MIGRATIONS ثبت و در onupgradeneeded به‌ترتیب اجرا می‌شود.
 */

import { normalizeListRow } from './listRow';
import type { ListEntity } from '@/types';

const DB_NAME = 'karam-db';
const DB_VERSION = 2;

export const STORES = {
  lists: 'lists',
  tasks: 'tasks',
  subtasks: 'subtasks',
  reminders: 'reminders',
  prefs: 'prefs',
  meta: 'meta',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * مهاجرت‌های نسخه‌دار — گام n از نسخه‌ی n−1 به n.
 * هر گام با همان تراکنش ارتقا اجرا می‌شود؛ نصب تازه (oldVersion=0) انبارها را می‌سازد و گام‌ها را روی داده‌ی خالی اجرا می‌کند.
 */
type Migration = (db: IDBDatabase, tx: IDBTransaction) => void;
const MIGRATIONS: Record<number, Migration> = {
  // v2 (فاز ۲ — قابلیت کامل لیست‌ها): ترمیم ردیف‌های آسیب‌دیده/قدیمی لیست
  // (رنگ/ترتیب/ایموجی نامعتبر به مقدار پیش‌فرض قطعی) — پایه‌ی امکانات فاز ۲
  2: (_db, tx) => {
    const store = tx.objectStore(STORES.lists);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const fixed = normalizeListRow(cursor.value as Record<string, unknown>);
      if (fixed === null) cursor.delete();
      else cursor.update(fixed as unknown as ListEntity);
      cursor.continue();
    };
  },
};

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const upTx = req.transaction as IDBTransaction;
      const oldVersion = (ev as IDBVersionChangeEvent).oldVersion;
      // lists
      if (!db.objectStoreNames.contains(STORES.lists)) {
        const s = db.createObjectStore(STORES.lists, { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
        s.createIndex('deletedAt', 'deletedAt');
        s.createIndex('sortOrder', 'sortOrder');
      }
      // tasks
      if (!db.objectStoreNames.contains(STORES.tasks)) {
        const s = db.createObjectStore(STORES.tasks, { keyPath: 'id' });
        s.createIndex('listId', 'listId');
        s.createIndex('dueDate', 'dueDate');
        s.createIndex('updatedAt', 'updatedAt');
        s.createIndex('deletedAt', 'deletedAt');
      }
      // subtasks
      if (!db.objectStoreNames.contains(STORES.subtasks)) {
        const s = db.createObjectStore(STORES.subtasks, { keyPath: 'id' });
        s.createIndex('taskId', 'taskId');
        s.createIndex('updatedAt', 'updatedAt');
        s.createIndex('deletedAt', 'deletedAt');
      }
      // reminders
      if (!db.objectStoreNames.contains(STORES.reminders)) {
        const s = db.createObjectStore(STORES.reminders, { keyPath: 'id' });
        s.createIndex('taskId', 'taskId');
        s.createIndex('fireAt', 'fireAt');
        s.createIndex('deletedAt', 'deletedAt');
      }
      // prefs و meta (key/value ساده)
      if (!db.objectStoreNames.contains(STORES.prefs)) {
        db.createObjectStore(STORES.prefs, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
      // اجرای مهاجرت‌های نسخه‌دار به‌ترتیب (نصب تازه: oldVersion=0 → فقط گام‌های تعریف‌شده روی داده‌ی خالی)
      for (let v = oldVersion + 1; v <= DB_VERSION; v++) {
        MIGRATIONS[v]?.(db, upTx);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function tx(store: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDb().then((db) => db.transaction(store, mode).objectStore(store));
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  const s = await tx(store, 'readonly');
  return wrap(s.getAll() as IDBRequest<T[]>);
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const s = await tx(store, 'readonly');
  return wrap(s.get(key) as IDBRequest<T | undefined>);
}

export async function idbPut<T>(store: StoreName, value: T): Promise<void> {
  const s = await tx(store, 'readwrite');
  await wrap(s.put(value as unknown as IDBValidKey));
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  const s = await tx(store, 'readwrite');
  await wrap(s.delete(key));
}

export async function idbCount(store: StoreName): Promise<number> {
  const s = await tx(store, 'readonly');
  return wrap(s.count() as IDBRequest<number>);
}

/** پاک‌کردن کامل یک انبار — برای پاک‌سازی داده‌ی کاربر هنگام خروج از حساب */
export async function idbClear(store: StoreName): Promise<void> {
  const s = await tx(store, 'readwrite');
  await wrap(s.clear() as IDBRequest<undefined>);
}

/** تراکنش چند-انبارشی برای seeding اتمی */
export async function seedTransaction(
  fn: (stores: Record<StoreName, IDBObjectStore>) => Promise<void>,
): Promise<void> {
  const db = await openDb();
  const names: StoreName[] = [STORES.lists, STORES.tasks, STORES.subtasks, STORES.reminders, STORES.prefs, STORES.meta];
  const t = db.transaction(names, 'readwrite');
  const stores = Object.fromEntries(names.map((n) => [n, t.objectStore(n)])) as Record<StoreName, IDBObjectStore>;
  await fn(stores);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('Seed transaction failed'));
  });
}
