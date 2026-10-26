/**
 * کارام — دعوت دوستان / رفرال (v20 — گام ۲۰ رشد)
 * وضعیت از /api/v1/me/referral خوانده می‌شود؛ فعال‌سازی کد دوست = هر دو طرف N روز پرو.
 */

import { authedFetch } from './api';

export interface ReferralInfo {
  enabled: boolean;
  days: number;
  code: string | null;
  shareUrl: string | null;
  invitedCount: number;
  canRedeem: boolean;
}

/** وضعیت رفرال کاربر جاری — ورود لازم است */
export async function fetchReferral(): Promise<ReferralInfo> {
  const res = await authedFetch<{ referral: ReferralInfo }>('/v1/me/referral');
  return res.referral;
}

/** فعال‌سازی کد دعوت دوست — هر دو طرف N روز پرو می‌گیرند */
export async function redeemReferral(code: string): Promise<{ message: string; days: number; premiumUntil: string }> {
  return authedFetch('/v1/me/referral', {
    method: 'POST',
    body: { code },
  });
}

/** متن پیش‌فرض اشتراک کد دعوت در تلگرام */
export function referralShareText(code: string, days: number): string {
  return `کارام — برنامه‌ریز و یادآور کارها 🌿\nبا کد دعوت من ${days} روز اشتراک پرو رایگان بگیر:\nکد: ${code}`;
}
