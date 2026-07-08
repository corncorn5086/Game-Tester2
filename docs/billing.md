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
| **Google Pay** | **Wired (needs Braintree keys)** | Braintree Drop-in. `POST /billing/checkout {provider:'google-pay'}` returns a `checkoutUrl`; the desktop opens the hosted Drop-in page; the page tokenizes and `POST /billing/braintree/transaction` charges + activates the plan. |
| **Apple Pay** | **Wired (needs Braintree keys)** | Same Braintree Drop-in flow (+ Apple merchant validation in your Braintree dashboard). |
| **Card (in-app fields)** | **Wired (needs Braintree keys)** | Braintree hosted card fields: PCI-safe, fully Ember-styled. |
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

## Enabling Braintree (Google Pay / Apple Pay / card)

1. Get API keys from your [Braintree dashboard](https://www.braintreegateway.com)
   (Account → My User → API Keys).
2. Install the SDK once: `npm install braintree -w @ember/backend`.
3. Put the credentials in `.env`:
   ```
   BRAINTREE_MERCHANT_ID=...
   BRAINTREE_PUBLIC_KEY=...
   BRAINTREE_PRIVATE_KEY=...
   BRAINTREE_ENV=sandbox
   ```
4. Restart the backend. `GET /billing/providers` now shows `google-pay`,
   `apple-pay` and `card` as `available`.
5. In Ember Desktop → Billing → Upgrade → pick Google Pay / Apple Pay / card:
   an Ember-styled Drop-in checkout window opens, you pay, and the subscription
   activates automatically. Click **"I paid — verify"** to confirm in-app.

Until the `braintree` package is installed, these endpoints return an explicit
`needsInstall` message — never a fake charge. Enable Apple Pay and Google Pay in
your Braintree control panel, and add your web domain for Apple Pay validation.

## Current honest limits

- Renewals are manual (single captures/sales). Recurring billing agreements are
  the next step (Braintree subscriptions API).
- No email receipts/PDF invoices until SMTP ships; captures are recorded in
  `usage_events` with the PayPal capture ID / Braintree transaction ID.
- Webhook verification (disputes, refunds, subscription lifecycle) is a next
  step; captures are synchronous today.
