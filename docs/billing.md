# Billing & payments

## Plans

| Plan | Price | For |
|---|---|---|
| **Free** | $0 | 1 project, local scans, limited reports (5/month), demo mode |
| **Pro** | $29 / user / month | Unlimited projects, real agent scans, report exports, custom test plans |
| **Studio** | $99 / workspace / month | Team workspace, shared reports, CI/CD, advanced triage, cloud sync |
| **Enterprise** | Custom | Custom integrations, private deployment, security controls, priority support |

Plan definitions: `shared/src/plans.js` · served by `GET /billing/plans`.

## Payment architecture — no hosted checkout page

Ember owns the entire checkout UI (Ember Desktop → Billing → Upgrade). Stripe's
hosted checkout was deliberately dropped as the primary path. Providers only
supply approval/tokenization:

| Method | Status | How |
|---|---|---|
| **PayPal** | **Wired (needs keys)** | Orders v2 REST. `POST /billing/checkout {provider:'paypal'}` creates the order; the user approves in a PayPal window; `POST /billing/paypal/capture` captures and activates the plan. |
| **Google Pay** | Prepared | Wallet button — requires a PSP behind it. Ships with the Braintree (PayPal) integration. |
| **Apple Pay** | Prepared | Same as Google Pay + Apple merchant validation. |
| **Card (in-app fields)** | Prepared | Braintree hosted fields: PCI-safe, fully Ember-styled. Until then cards work inside the PayPal approval window. |
| Stripe | Optional fallback | Env placeholders kept; not used by the UI. |

`GET /billing/providers` reports live availability — the desktop checkout modal
shows exactly what is configured and never simulates a charge.

## Enabling PayPal (sandbox in 5 minutes)

1. Create an app at [developer.paypal.com](https://developer.paypal.com) → REST API apps.
2. Put the credentials in `.env`:
   ```
   PAYPAL_CLIENT_ID=...
   PAYPAL_CLIENT_SECRET=...
   PAYPAL_ENV=sandbox
   ```
3. Restart the backend. `GET /billing/providers` now shows `paypal: available`.
4. In Ember Desktop → Billing → Upgrade to Pro → Pay with PayPal:
   the approval window opens, you approve with a sandbox buyer account,
   click **"I approved — capture payment"** — the subscription row flips to
   the paid plan and the capture ID is stored as the receipt.

Switch `PAYPAL_ENV=live` with live keys for production.

## Current honest limits

- Renewals are manual (single captures). Recurring agreements + wallet
  buttons (Google/Apple Pay) land with the Braintree integration
  (`BRAINTREE_*` placeholders in `.env.example`).
- No email receipts/PDF invoices until SMTP ships; captures are recorded in
  `usage_events` with the PayPal capture ID.
- Webhook verification (payment disputes, refunds) is a next step; captures
  are synchronous today.
