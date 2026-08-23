# Phase 2C — Razorpay billing + admin billing operations

**Date:** 2026-08-23  
**Scope:** Complete the existing Razorpay billing path and replace `/admin/billing`. No n8n, RLS, customer redesign, or schema migration.

---

## 1. Existing billing architecture

Phase 2C did **not** add a second payment stack. The existing abstractions remain:

| Piece | Location | Role |
|---|---|---|
| Plan catalog + limits | `src/lib/billing/plans.ts` | STARTER / PRO / ENTERPRISE definitions and `assertWithin*` |
| Provider interface | `src/lib/providers/types.ts` | `PaymentProvider.createCheckout` |
| Provider selection | `src/lib/billing/provider.ts` | Razorpay if keys exist, else Paddle |
| Razorpay adapter | `src/lib/billing/razorpay.ts` | Subscriptions, signatures, snapshot apply |
| Paddle adapter | `src/lib/billing/paddle.ts` | Fallback only while Razorpay is unset |
| Agency billing UI | `src/app/(app)/billing/page.tsx` + `billing-plans.tsx` | Existing pricing cards |
| Webhook | `src/app/api/webhooks/razorpay/route.ts` | Signed, idempotent |
| Idempotency | `WebhookEvent` + `claimWebhookEvent` | Unique `(provider, eventId)` |
| Subscription | Prisma `Subscription` | Plan, status, limits, provider refs |

The browser is never trusted for amount, currency, organization, or payment success.

---

## 2. Razorpay integration

Flow:

1. Owner submits a **plan id** only (`STARTER` or `PRO`).
2. `createAgencyCheckout` resolves the agency from the session user.
3. Server creates or reuses a Razorpay **subscription** (`plan_id` from env).
4. Checkout.js opens with the public Key ID + `subscription_id`.
5. Checkout handler posts `payment_id`, `subscription_id`, and `signature`.
6. Server verifies HMAC, then **fetches the live subscription from Razorpay**.
7. Database state is applied from that live snapshot.
8. Recurring truth is reconciled by the webhook.

Checkout verification is a UX-fast path. It still talks to Razorpay’s API. It is not “frontend said paid.” Webhooks remain required for renewals, failures, and cancellation.

Paddle code is unchanged and unused when Razorpay keys are present.

---

## 3. Environment variables

Server-only (never `NEXT_PUBLIC_` for secrets):

| Variable | Purpose |
|---|---|
| `RAZORPAY_KEY_ID` | Public checkout key (`rzp_test_…` or `rzp_live_…`) |
| `RAZORPAY_KEY_SECRET` | Server HMAC + API |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook HMAC |
| `RAZORPAY_PLAN_STARTER` | Razorpay plan id |
| `RAZORPAY_PLAN_PRO` | Razorpay plan id |

Missing keys: checkout returns a configuration error. Missing webhook secret: `POST /api/webhooks/razorpay` returns **503**. No fake success.

---

## 4. Plan mapping

Advertised product prices are unchanged:

| Plan | Advertised | Limits |
|---|---|---|
| STARTER | **$199 / month** | 100 leads, 3 seats, 5 automations, 200 WhatsApp |
| PRO | **$499 / month** | 2,000 leads, 15 seats, 25 automations, 2,000 WhatsApp |
| ENTERPRISE | Custom | Sales-led. No self-serve Razorpay plan |

The server never sends amount or currency to Razorpay. Charge amount is whatever the Razorpay **plan id** is configured as in the dashboard.

**Currency decision (not invented here):** ReviveLead’s UI stays in USD. Razorpay accounts are often INR. Operators must create dashboard plans that match the commercial price. This codebase does **not** apply a conversion rate.

---

## 5. Order / subscription flow

`createAgencyCheckout` / `startCheckoutAction`:

- Authenticated owner only (`withUser` + role check)
- Agency from session, not the client
- Demo org rejected
- Invalid plan rejected
- Client `amount` / `currency` / `organizationId` ignored
- Duplicate checkout reuses an existing Razorpay subscription when possible
- Returns `{ subscriptionId, keyId, … }` only — no secrets

---

## 6. Payment verification

`confirmRazorpayCheckout` / `verifyRazorpayCheckoutAction`:

1. Validate payment / subscription / signature shape
2. HMAC-SHA256(`payment_id|subscription_id`, Key Secret)
3. Fetch live subscription from Razorpay
4. Require the subscription to belong to the session org
5. Apply snapshot
6. `confirmed: true` only when status is `ACTIVE`

Invalid signature or org mismatch → fail. Status `created` stays unconfirmed (`TRIALING`).

---

## 7. Webhook verification

`POST /api/webhooks/razorpay`:

- Raw body HMAC vs `x-razorpay-signature`
- Missing signature → 400
- Invalid signature → 400
- Stale `created_at` (> 48h) → 400
- Unrecognized event → 200 `{ ignored: true }` (no state change)
- Organization resolved by `providerSubId`, then customer id, then notes (org must exist)

---

## 8. Idempotency

`claimWebhookEvent("razorpay", eventId)` uses `WebhookEvent` unique `(provider, eventId)`.

Event id: `x-razorpay-event-id` header, else `event:subscriptionId|paymentId:created_at`.

Duplicates return `{ ok: true, duplicate: true }` and do not re-apply.

---

## 9. Subscription state machine

Razorpay status → Prisma `SubscriptionStatus`:

| Razorpay | ReviveLead |
|---|---|
| `created` | `TRIALING` |
| `authenticated`, `active` | `ACTIVE` |
| `pending`, `halted`, `paused` | `PAST_DUE` |
| `cancelled`, `completed`, `expired` | `CANCELED` |

Event mapping:

| Event | Effect |
|---|---|
| `subscription.authenticated` / `activated` | ACTIVE + paid limits |
| `subscription.charged` | Renew (period end from snapshot) |
| `payment.failed` / `halted` / `pending` | PAST_DUE (paid limits kept as grace) |
| `subscription.cancelled` / `completed` | CANCELED + STARTER limits |
| Unknown | Ignored |

`cancel(subscriptionId, true)` is cancel-at-cycle-end. Access stays paid until Razorpay marks the subscription cancelled. The UI says cancellation was **requested**, not “cancelled immediately.”

---

## 10. Plan-limit enforcement

Server-side only: `assertWithinLeadLimit`, seats, automations, WhatsApp.

| Status | Limits applied |
|---|---|
| `ACTIVE` | Paid plan |
| `PAST_DUE` | Paid plan (grace; data kept) |
| `TRIALING` / `CANCELED` | STARTER limits |

Existing leads, members, and automations are **never deleted** when limits drop. New creates fail when over the new envelope.

Local `changePlanAction` is blocked when Razorpay or Paddle is configured.

---

## 11. Cancellation behavior

Owner cancel → Razorpay cancel at cycle end → audit `billing.subscription.cancelled` with `pendingWebhook: true`. If the live fetch fails, the action still succeeds as “requested.” Webhook applies CANCELED later.

Paid-period access continues while Razorpay status remains `active`.

---

## 12. Agency billing UI

`/billing` is unchanged visually: plan cards, usage bars, payment history from Razorpay invoices.

Checkout now disables while a request is in flight. Dismissed checkout is not treated as success. Unconfirmed checkout shows “not confirmed yet.”

---

## 13. Admin billing console

`/admin/billing` lists real `Subscription` rows (paginated, filterable by agency / plan / status):

- agency, plan, status, billing period, period end
- provider + subscription id
- created date
- last `billing.*` audit action when present

Platform-admin only. No secrets. No manual payment mutation in this phase.

---

## 14. Billing / audit events

Reuses `AuditLog`:

- `billing.order.created`
- `billing.payment.verified`
- `billing.subscription.activated`
- `billing.subscription.renewed`
- `billing.payment.failed`
- `billing.subscription.cancelled`
- `billing.webhook.processed`

Metadata is plan / event / status / payment id only. No signatures, secrets, or raw payloads.

Rejected webhooks stay on `logSecurity` (no org to attach).

---

## 15. Security controls

- Agency cannot open `/admin/billing`
- Plan/amount/currency/org cannot be elevated from the client
- Subscription status cannot be set from the browser
- Webhook signature required
- Duplicate events no-op
- Key Secret and webhook secret are server-only
- Checkout and verify require a signed-in owner
- Demo tenant is never billed

---

## 16. Test-mode setup

1. Razorpay Dashboard → Test mode
2. Create monthly plans (do not invent FX; match the advertised USD price in whatever currency the account uses)
3. Set `RAZORPAY_KEY_ID=rzp_test_…`, test secret, test plan ids, test webhook secret
4. Webhook URL: `https://<host>/api/webhooks/razorpay`
5. Subscribe to the events listed in `docs/PRODUCTION.md`

`rzp_test_` keys report checkout environment `sandbox`. Production is **not** switched on automatically.

---

## 17. Production setup requirements

Not claimed ready until all of the following are done **outside this repo**:

1. Live Razorpay account + live plan ids matching $199 / $499
2. `rzp_live_…` keys and live webhook secret in the host env (never in git)
3. Live webhook URL reachable and subscribed
4. A real end-to-end paid subscription observed in `/billing` and `/admin/billing`

---

## 18. Migration status

**Not required.** `Subscription`, `WebhookEvent`, and `AuditLog` already cover this phase.

Validation from `frontend/` on 2026-08-23:

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` | Pass — 13 files, **102/102** |
| `npm run build` | Pass |

---

## 19. Remaining billing work

- Create Razorpay dashboard plans (test, then live)
- Confirm live webhook delivery
- Enterprise / negotiated billing
- Persist invoice rows locally if operators need history when Razorpay is unreachable
- Optional later: capture auth/webhook security events in AuditLog
- Paddle remains fallback only
