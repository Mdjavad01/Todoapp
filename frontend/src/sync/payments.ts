/**
 * کارام — لایه‌ی پرداخت و اشتراک (فاز ۵)
 * پلن‌ها از سرور خوانده می‌شوند؛ سفارش با حساب کاربری ساخته می‌شود و
 * کاربر به درگاه زیبال هدایت می‌شود. بعد از بازگشت، وضعیت سفارش poll می‌شود.
 */

import { apiFetch, ApiError, authedFetch } from './api';
import { appPlatform } from '@/lib/native';
import { idbGet, idbPut, STORES } from '@/db/idb';

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

/* ---------------- کلید خاموش‌کردن پرداخت‌ها (گام ۲) ---------------- */

/** وضعیت پرداخت‌ها از سرور (GET /v1/payments/config) — برای پلتفرم خود اپ */
export interface PaymentsConfig {
  platform: 'web' | 'android';
  masterEnabled: boolean;
  platformEnabled: boolean;
  anyMethodEnabled: boolean;
  /** تصمیم نهایی سرور: master && platform && ≥۱ روش فعال */
  effective: boolean;
  /** کلید کد هدیه مستقل است — خاموشی پرداخت روی آن اثر ندارد */
  giftCodesEnabled: boolean;
  /** پیام نمایشی سرور وقتی پرداخت بسته است */
  message: string;
}

/** ثابت بیلد: VITE_PAYMENTS_BUILD=off → کل UI پرداخت در این بیلد حذف است (حالت bazaar بازار) */
export const PAYMENTS_BUILD: 'on' | 'off' =
  (import.meta.env.VITE_PAYMENTS_BUILD as string | undefined)?.toLowerCase() === 'off' ? 'off' : 'on';

/** پیش‌فرض محلی وقتی سرور در دسترس نیست — اندروید fail-closed، وب fail-open */
function fallbackConfig(reason: 'offline' | 'guest'): PaymentsConfig {
  const platform = appPlatform();
  const effective = platform === 'web'; // اندروید بدون پاسخ سرور = بسته (محتاطانه)
  return {
    platform,
    masterEnabled: true,
    platformEnabled: true,
    anyMethodEnabled: effective,
    effective,
    giftCodesEnabled: true,
    message:
      reason === 'guest'
        ? 'برای اطلاع از وضعیت خرید اشتراک، وارد حساب کاربری شوید.'
        : 'پرداخت‌ها موقتاً غیرفعال است؛ لطفاً بعداً با اتصال اینترنت بهتر تلاش کنید.',
  };
}

interface CachedPaymentsConfig {
  key: string;
  value: PaymentsConfig;
  fetchedAt: number;
}

const CFG_CACHE_KEY = 'payments-config-v1';

/**
 * وضعیت پرداخت‌ها — هر بار از سرور (پاسخ‌دهی کلید مهم است)، کش IndexedDB فقط
 * پشتیبانِ حالت آفلاین است؛ کش کهنه بهتر از هیچ است. منبع حقیقت سرور است و
 * مسیرهای شروع پرداخت سمت سرور هم مستقلاً گیت می‌شوند.
 */
export async function loadPaymentsConfig(): Promise<PaymentsConfig> {
  // بیلد bazaar — پرداخت از قبل حذف شده؛ سرور هم بی‌معناست
  if (PAYMENTS_BUILD === 'off') {
    return { ...fallbackConfig('offline'), effective: false, message: 'خرید اشتراک در این نسخه فعال نیست.' };
  }
  let cached: PaymentsConfig | null = null;
  try {
    const row = await idbGet<CachedPaymentsConfig>(STORES.meta, CFG_CACHE_KEY);
    if (row?.value) cached = row.value;
  } catch {
    /* IndexedDB در دسترس نیست — ادامه با سرور */
  }
  try {
    const res = await authedFetch<{ payments: PaymentsConfig }>('/v1/payments/config');
    const cfg = res.payments;
    if (cfg && typeof cfg.effective === 'boolean') {
      void idbPut<CachedPaymentsConfig>(STORES.meta, { key: CFG_CACHE_KEY, value: cfg, fetchedAt: Date.now() }).catch(
        () => undefined,
      );
      return cfg;
    }
    throw new Error('bad payload');
  } catch (e) {
    // مهمان (بدون ورود) endpoint ندارند — پیش‌فرض پلتفرم
    if (e instanceof ApiError && (e.status === 401 || e.code === 'unauthorized')) {
      return fallbackConfig('guest');
    }
    // آفلاین: کش کهنه بهتر از هیچ — وب بدون کش باز می‌ماند، اندروید بسته
    return cached ?? fallbackConfig('offline');
  }
}
