/**
 * PayPal provider — real REST integration (Orders v2).
 * Configure with PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (+ PAYPAL_ENV=sandbox|live).
 * Without keys every call returns an explicit not-configured result — never a fake payment.
 *
 * Flow (custom Ember checkout, no hosted processor page except PayPal approval):
 *   POST /billing/checkout {provider:'paypal', planId} → create order → approveUrl
 *   user approves in the PayPal window → POST /billing/paypal/capture {orderId}
 *   → capture + subscription row updated.
 */

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET ?? '';
const BASE = (process.env.PAYPAL_ENV ?? 'sandbox') === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

export const paypalConfigured = !!(CLIENT_ID && CLIENT_SECRET);

let tokenCache = { token: null, expiresAt: 0 };

async function accessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60000) return tokenCache.token;
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`paypal oauth → ${res.status}`);
  const data = await res.json();
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

async function api(method, path, body) {
  const token = await accessToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`paypal ${method} ${path} → ${res.status} ${JSON.stringify(data?.details ?? data?.message ?? '').slice(0, 200)}`);
  return data;
}

/** Create an order for a plan (first month). Returns { orderId, approveUrl }. */
export async function createOrder(plan, { returnUrl, cancelUrl } = {}) {
  if (!paypalConfigured) {
    return {
      error: 'PayPal is not configured',
      detail: 'Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env (sandbox keys from developer.paypal.com). No payment was simulated.',
      notConfigured: true
    };
  }
  const order = await api('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: plan.id,
      description: `Ember ${plan.name} plan — first month`,
      amount: { currency_code: 'USD', value: Number(plan.price).toFixed(2) }
    }],
    application_context: {
      brand_name: 'Ember',
      user_action: 'PAY_NOW',
      return_url: returnUrl ?? 'http://localhost:4310/billing/paypal/return',
      cancel_url: cancelUrl ?? 'http://localhost:4310/billing/paypal/cancel'
    }
  });
  const approveUrl = order.links?.find((l) => l.rel === 'approve')?.href ?? null;
  return { orderId: order.id, status: order.status, approveUrl };
}

/** Capture an approved order. Returns { captured, captureId, payerEmail }. */
export async function captureOrder(orderId) {
  if (!paypalConfigured) return { error: 'PayPal is not configured', notConfigured: true };
  const result = await api('POST', `/v2/checkout/orders/${orderId}/capture`, {});
  const capture = result.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    captured: result.status === 'COMPLETED',
    status: result.status,
    captureId: capture?.id ?? null,
    amount: capture?.amount ?? null,
    payerEmail: result.payer?.email_address ?? null,
    planId: result.purchase_units?.[0]?.reference_id ?? null
  };
}

export function paypalStatus() {
  return {
    provider: 'paypal',
    configured: paypalConfigured,
    env: process.env.PAYPAL_ENV ?? 'sandbox',
    note: paypalConfigured
      ? 'PayPal Orders API ready — custom Ember checkout, only the PayPal approval window is external.'
      : 'Add PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET to .env to enable real PayPal checkout.'
  };
}
