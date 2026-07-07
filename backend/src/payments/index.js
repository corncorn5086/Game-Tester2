/**
 * Provider-agnostic payment layer. Ember owns the checkout UI (no hosted
 * processor page) — providers only supply approval/tokenization.
 *
 *  - paypal      → real (Orders v2) when PAYPAL_* env keys are set
 *  - google-pay  → wallet button; requires a PSP behind it (Braintree/PayPal).
 *                  Prepared: returns an explicit roadmap status, never fakes.
 *  - apple-pay   → same as Google Pay + Apple merchant validation.
 *  - card        → direct card processing needs a PCI-scoped PSP; offered
 *                  through PayPal's card fields once Braintree keys exist.
 */
import { createOrder, captureOrder, paypalConfigured, paypalStatus } from './paypal.js';

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
    available: () => false,
    status: () => ({
      provider: 'google-pay', configured: false,
      note: 'Google Pay is a wallet, not a processor — it ships with the Braintree (PayPal) integration. UI is ready; add BRAINTREE_* keys when available.'
    })
  },
  {
    id: 'apple-pay',
    label: 'Apple Pay',
    kind: 'wallet',
    available: () => false,
    status: () => ({
      provider: 'apple-pay', configured: false,
      note: 'Apple Pay requires a PSP (Braintree) plus Apple merchant validation. UI is ready; enable after Braintree + merchant ID setup.'
    })
  },
  {
    id: 'card',
    label: 'Credit / debit card',
    kind: 'card',
    available: () => false,
    status: () => ({
      provider: 'card', configured: false,
      note: 'Direct card fields come with Braintree hosted fields (PCI-safe, fully Ember-styled). Until then cards work inside the PayPal approval window.'
    })
  }
];

export function listProviders() {
  return PROVIDERS.map((p) => ({ id: p.id, label: p.label, kind: p.kind, available: p.available(), ...p.status() }));
}

export async function startCheckout(provider, plan, urls) {
  if (provider === 'paypal') return createOrder(plan, urls);
  const p = PROVIDERS.find((x) => x.id === provider);
  if (!p) return { error: `unknown provider "${provider}"`, providers: PROVIDERS.map((x) => x.id) };
  return { error: `${p.label} is not available yet`, detail: p.status().note, notConfigured: true };
}

export { captureOrder };
