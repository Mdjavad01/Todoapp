/**
 * کارام — اطلاعیه‌های فعال سرور (فاز ۹ — بنر تبلیغ صفحه‌ی خانه)
 * endpoint عمومی است؛ مهمان‌ها هم بنر را می‌بینند.
 */

import { apiFetch } from './api';

export interface ActiveAnnouncement {
  uuid: string;
  title: string;
  body: string;
  type: 'info' | 'warning' | 'premium' | string;
  linkUrl: string | null;
  imageUrl: string | null;
  createdAt: string;
}

/** حداکثر ۳ اطلاعیه‌ی فعال با پنجره‌ی زمانی معتبر */
export async function fetchActiveAnnouncements(): Promise<ActiveAnnouncement[]> {
  const res = await apiFetch<{ items: ActiveAnnouncement[] }>('/v1/announcements/active');
  return res.items;
}
