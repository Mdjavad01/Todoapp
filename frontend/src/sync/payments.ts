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
  /** v20 — اگر کد هدیه اعمال شده باشد */
  originalPriceRials?: number;
  discountRials?: number;
  couponCode?: string | null;
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

/** ساخت سفارش و گرفتن لینک درگاه — نیازمند ورود؛ giftCode اختیاری (v20) */
export async function createPaymentOrder(planCode: string, giftCode?: string): Promise<CreateOrderResult> {
  return authedFetch<CreateOrderResult>('/v1/payments/orders', {
    method: 'POST',
    body: { planCode, ...(giftCode && giftCode.trim() !== '' ? { giftCode: giftCode.trim() } : {}) },
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

/* ---------------- کارت‌به‌کارت با تأیید ادمین (فاز ۸) ---------------- */

export interface DepositConfig {
  enabled: boolean;
  card?: {
    number: string;
    holder: string;
    guide: string;
  };
}

export type DepositStatus = 'pending' | 'approved' | 'rejected';

export interface DepositRequest {
  uuid: string;
  planCode: string;
  planTitle: string | null;
  amountRials: number;
  /** v20 — اگر کد هدیه روی واریز اعمال شده باشد */
  discountRials?: number;
  couponCode?: string | null;
  reference: string;
  status: DepositStatus;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

/** پیکربندی کارت‌به‌کارت — شماره کارت ادمین و راهنما (فقط اگر فعال باشد) */
export async function fetchDepositConfig(): Promise<DepositConfig> {
  return authedFetch<DepositConfig>('/v1/payments/deposit/config');
}

/** ثبت درخواست واریز کارت‌به‌کارت — بعد از تأیید ادمین اشتراک فعال می‌شود (giftCode اختیاری — v20) */
export async function createDepositRequest(planCode: string, reference: string, note?: string, giftCode?: string): Promise<DepositRequest> {
  const res = await authedFetch<{ message: string; request: DepositRequest }>('/v1/payments/deposit/requests', {
    method: 'POST',
    body: {
      planCode,
      reference,
      note: note?.trim() ? note.trim() : undefined,
      ...(giftCode && giftCode.trim() !== '' ? { giftCode: giftCode.trim() } : {}),
    },
  });
  return res.request;
}

/* ---------------- کد هدیه (v20) ---------------- */

export interface GiftQuote {
  valid: boolean;
  error?: string;
  code?: string;
  discountRials?: number;
  payableRials?: number;
}

/** استعلام زنده‌ی کد هدیه برای پلن — نمایش تخفیف قبل از پرداخت */
export async function fetchGiftQuote(code: string, planCode: string): Promise<GiftQuote> {
  return authedFetch<GiftQuote>(
    `/v1/payments/gift/quote?code=${encodeURIComponent(code.trim())}&plan=${encodeURIComponent(planCode)}`,
  );
}

/** درخواست‌های واریز من — ۱۰ مورد آخر با وضعیت */
export async function fetchMyDepositRequests(): Promise<DepositRequest[]> {
  const res = await authedFetch<{ requests: DepositRequest[] }>('/v1/payments/deposit/requests/mine');
  return res.requests;
}

/* ---------------- روش‌های پرداخت (فاز ۹ — انتخاب روش قبل از پرداخت) ---------------- */

export interface PaymentMethod {
  code: string; // 'online' | 'card' | 'agpay'
  title: string;
  description: string;
  enabled: boolean;
  soon: boolean;
}

/**
 * فهرست روش‌های پرداخت و وضعیت فعال بودن هرکدام — ورود لازم است.
 * روش‌های آینده با enabled=false برمی‌گردند تا در صفحه‌ی انتخاب با بج «به‌زودی» دیده شوند.
 */
export async function fetchPaymentMethods(): Promise<PaymentMethod[]> {
  const res = await authedFetch<{ methods: PaymentMethod[] }>('/v1/payments/methods');
  return res.methods;
}
