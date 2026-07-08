import { useEffect, useState } from 'react';
import { CreditCard, Check, X } from 'lucide-react';
import { PLANS } from '@ember/shared/plans';
import { useApp } from '../lib/store.jsx';
import { bridge } from '../lib/bridge.js';
import { Blocked } from '../components/common.jsx';

/**
 * Billing (v2): plans + payment methods with Ember's own checkout UI.
 * PayPal is the primary processor (real Orders API when keys are set);
 * Google Pay / Apple Pay / direct card ship with the Braintree layer and
 * are shown with honest availability states — never a fake charge.
 */
const METHOD_META = {
  paypal: { mark: 'P', markBg: '#003087', desc: 'Pay with your PayPal balance, bank or card. Only the approval window is external — everything else stays in Ember.' },
  'google-pay': { mark: 'G', markBg: '#1a73e8', desc: 'One-tap wallet payment via Braintree — opens an Ember-styled checkout window.' },
  'apple-pay': { mark: '', markBg: '#f4f4f5', desc: 'Touch ID / Face ID wallet payment via Braintree — opens an Ember-styled checkout window.' },
  card: { mark: '💳', markBg: 'transparent', desc: 'PCI-safe hosted card fields via Braintree, fully Ember-styled.' }
};

function CheckoutModal({ plan, providers, onClose }) {
  const { api, toast } = useApp();
  const available = providers.filter((p) => p.available);
  const [method, setMethod] = useState(available[0]?.id ?? 'paypal');
  const [phase, setPhase] = useState('pick'); // pick | approving | done | error
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);

  const pay = async () => {
    setError(null);
    try {
      const res = await api.checkout(plan.id, method);
      if (res.approveUrl) {
        // PayPal: approve window → manual capture
        setOrder(res);
        setPhase('approving');
        bridge.openExternal(res.approveUrl);
      } else if (res.braintree && res.checkoutUrl) {
        // Braintree (Google Pay / Apple Pay / card): hosted Drop-in page charges server-side
        setOrder(res);
        setPhase('braintree');
        bridge.openExternal(res.checkoutUrl);
      } else {
        setError(res.detail ?? res.error ?? 'Checkout could not start');
        setPhase('error');
      }
    } catch (e) {
      setError(e.data?.detail ?? e.message);
      setPhase('error');
    }
  };

  const finishCapture = async () => {
    try {
      const res = await api.paypalCapture(order.orderId);
      if (res.captured) {
        setPhase('done');
        toast(`Payment received — ${plan.name} plan active`);
      } else {
        setError(`Order status: ${res.status}. Approve the payment in the PayPal window first.`);
      }
    } catch (e) {
      setError(e.data?.error ?? e.message);
    }
  };

  const verifyBraintree = async () => {
    setError(null);
    try {
      const sub = await api.subscription();
      if (sub?.plan?.id === plan.id && sub.status === 'active') {
        setPhase('done');
        toast(`Payment received — ${plan.name} plan active`);
      } else {
        setError('No completed payment yet — finish the checkout in the browser window, then verify again.');
      }
    } catch (e) {
      setError(e.data?.error ?? e.message);
    }
  };

  return (
    <div className="overlay" onClick={onClose} style={{ alignItems: 'center', paddingTop: 0 }}>
      <div className="palette" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Upgrade to {plan.name}</div>
            <div className="micro-mono" style={{ marginTop: 3 }}>${plan.price} / {plan.period} · cancel anytime</div>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--ink-faint)', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        <div style={{ padding: 24 }}>
          {phase === 'pick' && (
            <>
              <div className="panel-label">Payment method</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {providers.map((p) => {
                  const meta = METHOD_META[p.id] ?? {};
                  const on = method === p.id;
                  return (
                    <button key={p.id} disabled={!p.available} onClick={() => setMethod(p.id)} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderRadius: 11, cursor: p.available ? 'pointer' : 'not-allowed',
                      border: `1px solid ${on ? 'rgba(255,110,50,.5)' : 'var(--line)'}`,
                      background: on ? 'rgba(255,77,0,.07)' : 'var(--panel-2)', color: 'var(--ink)', textAlign: 'left',
                      opacity: p.available ? 1 : 0.5, transition: 'all .18s'
                    }}>
                      <span style={{
                        width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0,
                        background: meta.markBg, color: p.id === 'apple-pay' ? '#08080a' : '#fff', fontWeight: 700, fontSize: 13
                      }}>{meta.mark}</span>
                      <span style={{ flex: 1 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>{p.label}</span>
                        <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', display: 'block', marginTop: 2, lineHeight: 1.4 }}>
                          {p.available ? meta.desc : p.note}
                        </span>
                      </span>
                      {p.available ? (on && <Check size={15} color="var(--accent-soft)" />) : <span className="chip dim" style={{ fontSize: 8.5 }}>soon</span>}
                    </button>
                  );
                })}
              </div>
              {available.length === 0 && (
                <div className="blocked-banner" style={{ marginTop: 14 }}>
                  No payment provider is configured yet. Add PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (sandbox keys from developer.paypal.com) to .env and restart the backend — no payment is ever simulated.
                </div>
              )}
              <button className="btn btn-fire" style={{ width: '100%', marginTop: 18 }} disabled={available.length === 0} onClick={pay}>
                Pay ${plan.price} with {providers.find((p) => p.id === method)?.label ?? '…'}
              </button>
              <div className="micro-mono" style={{ marginTop: 10, textAlign: 'center', fontSize: 10 }}>
                Ember never sees card numbers — tokenization happens at the provider.
              </div>
            </>
          )}

          {phase === 'approving' && (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Approve the payment in the PayPal window</div>
              <p style={{ fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.6, marginBottom: 16 }}>
                A PayPal approval window opened in your browser (order <code style={{ fontSize: 11 }}>{order?.orderId}</code>).
                Once you approve it there, come back and finish below.
              </p>
              <button className="btn btn-white" onClick={finishCapture}>I approved — capture payment</button>
              {error && <div className="error-banner" style={{ marginTop: 12, textAlign: 'left' }}>{error}</div>}
            </div>
          )}

          {phase === 'braintree' && (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Complete payment in the secure window</div>
              <p style={{ fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.6, marginBottom: 16 }}>
                An Ember checkout window opened in your browser with {providers.find((p) => p.id === method)?.label ?? 'your payment method'}.
                Finish the payment there — it's charged securely via Braintree — then verify below.
              </p>
              <button className="btn btn-white" onClick={verifyBraintree}>I paid — verify</button>
              {error && <div className="error-banner" style={{ marginTop: 12, textAlign: 'left' }}>{error}</div>}
            </div>
          )}

          {phase === 'done' && (
            <div style={{ textAlign: 'center', padding: '14px 0' }}>
              <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'rgba(52,211,153,.15)', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}>
                <Check size={22} color="var(--ok)" />
              </div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{plan.name} plan is active</div>
              <p style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 6 }}>Receipt recorded in usage events; invoice email follows once SMTP is configured.</p>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={onClose}>Close</button>
            </div>
          )}

          {phase === 'error' && (
            <>
              <div className="error-banner">{error}</div>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={() => setPhase('pick')}>Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Billing() {
  const { api, backendHealth, toast } = useApp();
  const [subscription, setSubscription] = useState(null);
  const [providers, setProviders] = useState([]);
  const [checkoutPlan, setCheckoutPlan] = useState(null);
  const online = backendHealth?.ok;

  useEffect(() => {
    if (!online) return;
    api.subscription().then(setSubscription).catch(() => setSubscription(null));
    api.paymentProviders().then(setProviders).catch(() => setProviders([]));
  }, [api, online]);

  const currentPlan = subscription?.plan?.id ?? 'free';

  return (
    <div>
      {!online && (
        <Blocked>
          Billing is managed by the Ember backend (offline right now). Ember Desktop stays fully functional in
          local-only mode on the Free tier.
        </Blocked>
      )}

      <div className="card" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
        <CreditCard size={18} color="var(--accent-soft)" />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            Current plan: {subscription?.plan?.name ?? 'Free'} <span className="chip ok" style={{ marginLeft: 8 }}>{subscription?.status ?? 'active'}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 3 }}>
            {subscription?.currentPeriodEnd ? `Renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}` : online ? 'Managed by your workspace subscription.' : 'Local mode — Free plan limits.'}
          </div>
        </div>
      </div>

      {/* payment methods */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="panel-label">Payment methods</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
          {(providers.length ? providers : [{ id: 'paypal', label: 'PayPal', available: false, note: 'Backend offline — providers appear when connected.' }]).map((p) => {
            const meta = METHOD_META[p.id] ?? {};
            return (
              <div key={p.id} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '13px 14px', borderRadius: 11, border: '1px solid var(--line)', background: 'var(--panel-2)' }}>
                <span style={{ width: 28, height: 28, borderRadius: 7, display: 'grid', placeItems: 'center', flexShrink: 0, background: meta.markBg, color: p.id === 'apple-pay' ? '#08080a' : '#fff', fontWeight: 700, fontSize: 12 }}>{meta.mark}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{p.label}</span>
                    <span className={`chip ${p.available ? 'ok' : 'dim'}`} style={{ fontSize: 8.5 }}>{p.available ? 'ready' : 'soon'}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 3, lineHeight: 1.45 }}>{p.available ? meta.desc : p.note}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="micro-mono" style={{ marginTop: 12, fontSize: 10 }}>
          Checkout runs in Ember's own UI. PayPal is the primary processor; Google Pay, Apple Pay and cards run through Braintree. No Stripe by design.
        </div>
      </div>

      {/* plans */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(198px,1fr))', gap: 12, marginTop: 16 }}>
        {PLANS.map((p) => {
          const isLifetime = p.oneTime;
          return (
          <div key={p.id} className="card" style={{
            ...(p.id === currentPlan ? { borderColor: 'rgba(255,110,50,.5)' } : {}),
            ...(isLifetime ? { borderColor: 'rgba(255,110,50,.45)', background: 'linear-gradient(180deg, rgba(255,77,0,.06), transparent 60%)' } : {})
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3>{p.name}</h3>
              {p.id === currentPlan && <span className="chip ok">current</span>}
              {isLifetime && p.id !== currentPlan && <span className="chip fire" style={{ fontSize: 8.5 }}>best value</span>}
            </div>
            <div style={{ marginTop: 10, fontSize: 30, fontWeight: 600 }}>
              {p.price === null ? 'Custom' : p.price === 0 ? 'Free' : `$${p.price}`}
              {p.price ? <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}> {isLifetime ? 'once' : `/${p.period}`}</span> : null}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 4, minHeight: 32 }}>{p.tagline}</div>
            <ul style={{ marginTop: 12, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12, color: 'var(--ink-dim)', minHeight: 130 }}>
              {p.features.map((f) => (
                <li key={f} style={{ display: 'flex', gap: 7 }}><Check size={13} color="var(--accent-soft)" style={{ flexShrink: 0, marginTop: 2 }} /> {f}</li>
              ))}
            </ul>
            <button
              className={`btn btn-sm ${p.id === currentPlan ? 'btn-ghost' : 'btn-fire'}`}
              style={{ width: '100%', marginTop: 12 }}
              disabled={p.id === currentPlan || !online}
              onClick={() => (p.id === 'enterprise' ? toast('Enterprise is custom-quoted — hello@ember.dev') : setCheckoutPlan(p))}
            >
              {p.id === currentPlan ? 'Active' : p.id === 'enterprise' ? 'Contact us' : isLifetime ? 'Buy Lifetime' : p.price === 0 ? 'Downgrade' : `Upgrade to ${p.name}`}
            </button>
          </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Billing history & invoices</h3>
        <p style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-faint)', lineHeight: 1.6 }}>
          Captured payments are recorded in usage events (backend) with the PayPal capture ID as receipt. PDF invoices
          and email receipts land with the SMTP integration. Subscriptions renew manually until PayPal subscription
          agreements ship with Braintree.
        </p>
      </div>

      {checkoutPlan && <CheckoutModal plan={checkoutPlan} providers={providers} onClose={() => setCheckoutPlan(null)} />}
    </div>
  );
}
