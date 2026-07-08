/**
 * Provider-agnostic payment layer. Ember owns the checkout UI (no hosted
 * processor page) — providers only supply approval/tokenization.
 *
 *  - paypal      → real (Orders v2) when PAYPAL_* env keys are set.
 *  - google-pay  → real via Braintree Drop-in when BRAINTREE_* keys are set.
 *  - apple-pay   → real via Braintree Drop-in (+ Apple merchant validation).
 *  - card        → real via Braintree hosted card fields.
 *
 * Without the matching keys, every provider returns an explicit
 * not-configured result — never a fake payment.
 */
import { createOrder, captureOrder, paypalConfigured, paypalStatus } from './paypal.js';
import { braintreeConfigured, braintreeStatus, clientToken, sale, checkoutPage } from './braintree.js';

const braintreeNote = (wallet) => braintreeConfigured
  ? `${wallet} is live via Braintree — opens an Ember-styled Drop-in checkout.`
  : `${wallet} ships with Braintree. UI is ready; add BRAINTREE_* keys in .env to enable it.`;

export const PROVIDERS = [
  {
    id: 'paypal',
    label: 'PayPal',
    kind: 'processor',
    available: () => paypalConfigured,
    status: paypalStatus
  },
  {
    id: 'google-pay',
    label: 'Google Pay',
    kind: 'wallet',
    available: () => braintreeConfigured,
    status: () => ({ provider: 'google-pay', configured: braintreeConfigured, via: 'braintree', note: braintreeNote('Google Pay') })
  },
  {
    id: 'apple-pay',
    label: 'Apple Pay',
    kind: 'wallet',
    available: () => braintreeConfigured,
    status: () => ({ provider: 'apple-pay', configured: braintreeConfigured, via: 'braintree', note: braintreeNote('Apple Pay') })
  },
  {
    id: 'card',
    label: 'Credit / debit card',
    kind: 'card',
    available: () => braintreeConfigured,
    status: () => ({ provider: 'card', configured: braintreeConfigured, via: 'braintree', note: braintreeNote('Card payments') })
  }
];

const BRAINTREE_PROVIDERS = new Set(['google-pay', 'apple-pay', 'card']);

export function listProviders() {
  return PROVIDERS.map((p) => ({ id: p.id, label: p.label, kind: p.kind, available: p.available(), ...p.status() }));
}

export async function startCheckout(provider, plan, urls = {}) {
  if (provider === 'paypal') return createOrder(plan, urls);

  if (BRAINTREE_PROVIDERS.has(provider)) {
    if (!braintreeConfigured) {
      return { error: `${provider} is not available yet`, detail: braintreeStatus().note, notConfigured: true };
    }
    // Braintree providers tokenize in a hosted Drop-in page, opened like the
    // PayPal approval window; the desktop app opens `checkoutUrl`.
    const base = urls.apiBase ?? '';
    return { braintree: true, provider, checkoutUrl: `${base}/billing/braintree/checkout?plan=${encodeURIComponent(plan.id)}` };
  }

  const p = PROVIDERS.find((x) => x.id === provider);
  if (!p) return { error: `unknown provider "${provider}"`, providers: PROVIDERS.map((x) => x.id) };
  return { error: `${p.label} is not available yet`, detail: p.status().note, notConfigured: true };
}

export { captureOrder, braintreeConfigured, clientToken, sale, checkoutPage };
