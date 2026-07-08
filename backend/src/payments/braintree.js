/**
 * Braintree provider — real integration that unlocks Google Pay, Apple Pay
 * and Ember-styled card fields. Configure with:
 *   BRAINTREE_MERCHANT_ID / BRAINTREE_PUBLIC_KEY / BRAINTREE_PRIVATE_KEY
 *   BRAINTREE_ENV=sandbox|production   (default: sandbox)
 *
 * Flow (custom Ember checkout, only the Braintree Drop-in fields are hosted):
 *   GET  /billing/braintree/client-token         → clientToken
 *   GET  /billing/braintree/checkout?plan=…       → hosted Drop-in page (Google/Apple/card)
 *   POST /billing/braintree/transaction {nonce}   → sale + subscription activated
 *
 * The `braintree` npm package is loaded lazily. If it is not installed, every
 * call returns an explicit `needsInstall` result — never a fake transaction.
 */

const MERCHANT_ID = process.env.BRAINTREE_MERCHANT_ID ?? '';
const PUBLIC_KEY = process.env.BRAINTREE_PUBLIC_KEY ?? '';
const PRIVATE_KEY = process.env.BRAINTREE_PRIVATE_KEY ?? '';
const ENV_NAME = (process.env.BRAINTREE_ENV ?? 'sandbox').toLowerCase();

export const braintreeConfigured = !!(MERCHANT_ID && PUBLIC_KEY && PRIVATE_KEY);

let gatewayCache = null;
let loadError = null;

/** Lazily build the Braintree gateway. Returns null (and sets loadError) if the SDK is missing. */
async function gateway() {
  if (gatewayCache) return gatewayCache;
  if (!braintreeConfigured) return null;
  let braintree;
  try {
    braintree = (await import('braintree')).default ?? (await import('braintree'));
  } catch {
    loadError = 'The "braintree" package is not installed. Run `npm install braintree -w @ember/backend` to enable Google Pay / Apple Pay / card payments.';
    return null;
  }
  const environment = ENV_NAME === 'production' ? braintree.Environment.Production : braintree.Environment.Sandbox;
  gatewayCache = new braintree.BraintreeGateway({
    environment,
    merchantId: MERCHANT_ID,
    publicKey: PUBLIC_KEY,
    privateKey: PRIVATE_KEY
  });
  return gatewayCache;
}

function notConfigured() {
  return {
    error: 'Braintree is not configured',
    detail: 'Set BRAINTREE_MERCHANT_ID / BRAINTREE_PUBLIC_KEY / BRAINTREE_PRIVATE_KEY in .env (from your Braintree dashboard). No payment was simulated.',
    notConfigured: true
  };
}

/** A client token authorizes the Drop-in UI in the browser to tokenize a payment method. */
export async function clientToken() {
  if (!braintreeConfigured) return notConfigured();
  const gw = await gateway();
  if (!gw) return { error: loadError, needsInstall: true };
  const { clientToken } = await gw.clientToken.generate({});
  return { clientToken, env: ENV_NAME };
}

/**
 * Charge a plan with a payment-method nonce produced by the Drop-in / wallet.
 * Returns { captured, transactionId, amount, planId, method }.
 */
export async function sale(plan, nonce, { deviceData } = {}) {
  if (!braintreeConfigured) return notConfigured();
  const gw = await gateway();
  if (!gw) return { error: loadError, needsInstall: true };
  const result = await gw.transaction.sale({
    amount: Number(plan.price).toFixed(2),
    paymentMethodNonce: nonce,
    deviceData,
    options: { submitForSettlement: true },
    customFields: undefined,
    orderId: `ember-${plan.id}`
  });
  if (!result.success) {
    return { captured: false, error: result.message ?? 'Braintree declined the transaction', declined: true };
  }
  const t = result.transaction;
  return {
    captured: t.status === 'submitted_for_settlement' || t.status === 'settling' || t.status === 'settled',
    status: t.status,
    transactionId: t.id,
    amount: { value: t.amount, currency_code: t.currencyIsoCode },
    method: t.paymentInstrumentType,
    planId: plan.id
  };
}

export function braintreeStatus() {
  return {
    provider: 'braintree',
    configured: braintreeConfigured,
    env: ENV_NAME,
    note: braintreeConfigured
      ? 'Braintree ready — unlocks Google Pay, Apple Pay and Ember-styled card fields via a hosted Drop-in.'
      : 'Add BRAINTREE_MERCHANT_ID / BRAINTREE_PUBLIC_KEY / BRAINTREE_PRIVATE_KEY to .env to enable Google Pay, Apple Pay and card payments.'
  };
}

/** Server-rendered Braintree Drop-in checkout page (opened like the PayPal approval window). */
export function checkoutPage(plan, apiBase) {
  const safePlan = { id: String(plan.id), name: String(plan.name), price: Number(plan.price) };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ember — ${safePlan.name} checkout</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#08080a;color:#f4f4f5;margin:0;display:grid;place-items:center;min-height:100vh;padding:24px}
  .card{width:100%;max-width:440px;background:#111013;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:28px}
  .brand{display:flex;align-items:center;gap:8px;font-weight:600;font-size:15px;margin-bottom:18px}
  .dot{width:10px;height:10px;border-radius:50%;background:#ff4d00;box-shadow:0 0 14px #ff4d00}
  h1{font-size:19px;margin:0 0 4px}
  .muted{color:rgba(244,244,245,.55);font-size:13px;margin:0 0 20px}
  .amt{font-family:ui-monospace,monospace;font-size:28px;font-weight:600;margin:0 0 20px}
  #dropin-container{margin-bottom:16px}
  button{width:100%;border:none;border-radius:12px;padding:14px;font-size:15px;font-weight:600;cursor:pointer;background:#ff4d00;color:#fff}
  button:disabled{opacity:.5;cursor:not-allowed}
  .status{margin-top:14px;font-size:13px;text-align:center;min-height:18px}
  .ok{color:#34d399}.err{color:#f87171}
</style></head>
<body>
  <div class="card">
    <div class="brand"><span class="dot"></span> Ember</div>
    <h1>${safePlan.name} plan</h1>
    <p class="muted">Google Pay, Apple Pay or card — powered by Braintree. Only these payment fields are hosted; the rest is Ember.</p>
    <div class="amt">$${safePlan.price.toFixed(2)}<span style="font-size:13px;color:rgba(244,244,245,.4)"> / month</span></div>
    <div id="dropin-container"></div>
    <button id="pay" disabled>Pay $${safePlan.price.toFixed(2)}</button>
    <div class="status" id="status">Loading secure payment fields…</div>
  </div>
  <script src="https://js.braintreegateway.com/web/dropin/1.42.0/js/dropin.min.js"></script>
  <script>
    const API = ${JSON.stringify(apiBase)};
    const PLAN = ${JSON.stringify(safePlan)};
    const statusEl = document.getElementById('status');
    const payBtn = document.getElementById('pay');
    function setStatus(msg, cls){ statusEl.textContent = msg; statusEl.className = 'status ' + (cls||''); }
    async function boot(){
      const r = await fetch(API + '/billing/braintree/client-token');
      const d = await r.json();
      if(!d.clientToken){ setStatus(d.error || 'Cannot start checkout', 'err'); return; }
      braintree.dropin.create({
        authorization: d.clientToken,
        container: '#dropin-container',
        googlePay: { googlePayVersion: 2, transactionInfo: { totalPriceStatus:'FINAL', totalPrice: PLAN.price.toFixed(2), currencyCode:'USD' } },
        applePay: { displayName:'Ember', paymentRequest:{ total:{ label:'Ember', amount: PLAN.price.toFixed(2) } } },
        card: { cardholderName: true }
      }, (err, instance) => {
        if(err){ setStatus(err.message,'err'); return; }
        setStatus('');
        payBtn.disabled = false;
        payBtn.onclick = () => {
          payBtn.disabled = true; setStatus('Processing…');
          instance.requestPaymentMethod((e, payload) => {
            if(e){ setStatus(e.message,'err'); payBtn.disabled=false; return; }
            fetch(API + '/billing/braintree/transaction', {
              method:'POST', headers:{'content-type':'application/json'},
              body: JSON.stringify({ planId: PLAN.id, nonce: payload.nonce, deviceData: payload.deviceData })
            }).then(x=>x.json()).then(res => {
              if(res.captured){ setStatus('✓ Payment complete — return to Ember Desktop.','ok'); payBtn.style.display='none'; }
              else { setStatus(res.error || 'Payment declined','err'); payBtn.disabled=false; }
            }).catch(()=>{ setStatus('Network error','err'); payBtn.disabled=false; });
          });
        };
      });
    }
    boot().catch(e=>setStatus(e.message,'err'));
  </script>
</body></html>`;
}
