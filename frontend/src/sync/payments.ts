/**
 * کارام — لایه‌ی پرداخت و اشتراک (فاز ۵)
 * پلن‌ها از سرور خوانده می‌شوند؛ سفارش با حساب کاربری ساخته می‌شود و
 * کاربر به درگاه زیبال هدایت می‌شود. بعد از بازگشت، وضعیت سفارش poll می‌شود.
 */

import { apiFetch, authedFetch } from './api';

export interface Plan {
  code: string;
  title: string;
  months: number; // 0 = دائمی
  priceRials: number;
  description: string | null;
}

export interface SubscriptionStatus {
  isPremium: boolean;
  premiumUntil: string | null;
  daysLeft: number | null;
  lifetime: boolean;
  plan: { code: string; title: string } | null;
  source: string | null;
  expiresAt: string | null;
}

export interface CreateOrderResult {
  orderUuid: string;
  trackId: string;
  payUrl: string;
  amountRials: number;
}

export interface OrderStatus {
  uuid: string;
  status: 'created' | 'redirected' | 'paid' | 'failed' | 'pending_review' | 'approved' | 'rejected' | 'refunded';
  amountRials: number;
  planCode: string;
  planTitle: string;
  createdAt: string;
  updatedAt: string;
}

/** پلن‌های فعال سرور — عمومی (بدون احراز) */
export async function fetchPlans(): Promise<Plan[]> {
  const res = await apiFetch<{ plans: Plan[] }>('/v1/plans');
  return res.plans;
}

/** ساخت سفارش و گرفتن لینک درگاه — نیازمند ورود */
export async function createPaymentOrder(planCode: string): Promise<CreateOrderResult> {
  return authedFetch<CreateOrderResult>('/v1/payments/orders', {
    method: 'POST',
    body: { planCode },
  });
}

/** وضعیت سفارش — بعد از بازگشت از درگاه تا دیدن نتیجه */
export async function fetchOrderStatus(orderUuid: string): Promise<OrderStatus> {
  const res = await authedFetch<{ order: OrderStatus }>(`/v1/payments/orders/${encodeURIComponent(orderUuid)}`);
  return res.order;
}

/** وضعیت اشتراک کاربر جاری */
export async function fetchSubscription(): Promise<SubscriptionStatus> {
  const res = await authedFetch<{ subscription: SubscriptionStatus }>('/v1/me/subscription');
  return res.subscription;
}
