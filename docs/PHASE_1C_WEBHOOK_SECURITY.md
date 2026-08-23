# Phase 1C — Webhook security hardening

**Date:** 2026-08-23  
**Scope:** S2 targeted secret lookup and S3 inbound signature verification from `docs/PHASE_1_BACKEND_AUDIT.md`. No Razorpay work, no n8n feature work, no RLS, no schema migration.

---

## Webhook endpoints audited

| Endpoint | Provider | Auth before | Auth after | Touched? |
|---|---|---|---|---|
| `GET /api/webhooks/inbound` | Meta WhatsApp subscribe | Scan all WhatsApp secrets for `hub.verify_token` | Fingerprint lookup of the verify token (Meta’s documented query-token handshake) | Yes |
| `POST /api/webhooks/inbound` Meta | WhatsApp Cloud API | Parse payload → optional secret header fallback → then `x-hub-signature-256` | Resolve by `phone_number_id`, then HMAC-SHA256 of the raw body **before** any write | Yes |
| `POST /api/webhooks/inbound` custom | Agency webhook / inbound JSON | Shared secret header only | Require `x-revivelead-integration` + HMAC (`x-revivelead-signature` or `x-hub-signature-256`). Secret header alone is rejected | Yes |
| `POST /api/webhooks/paddle` | Paddle | `paddle-signature` via Paddle SDK | Unchanged | No |
| `POST /api/webhooks/razorpay` | Razorpay | `x-razorpay-signature` HMAC | Unchanged (out of scope) | No |
| `POST /api/webhooks/n8n` | n8n | Shared secret header + full integration scan | Same contract; lookup is now fingerprint-targeted via `resolveOrgFromSecret` | Lookup only |
| `POST /api/ingest/website` | Website ingest | Shared secret header + scan | Same contract; fingerprint lookup | Lookup only |
| `POST /api/ingest/leads` | API ingest | API key hash, then secret scan, then session | API key hash unchanged; secret fallback is fingerprint-targeted | Lookup only |

Intentionally unauthenticated: none of the inbound webhook routes. Meta GET remains the only documented query-token handshake (Meta’s specification, not a ReviveLead invention).

---

## Secret lookup before / after (S2)

**Before:** `resolveOrgFromSecret` and `resolveOrgFromPhoneNumberId` loaded every enabled integration of the given types and compared secrets / phone IDs in process memory. Colliding secrets resolved to the first match.

**After (no migration):**

| Identifier | Lookup |
|---|---|
| Integration id (`x-revivelead-integration`) | `findFirst` on primary key + type + enabled |
| Shared secret / Meta verify token | SHA-256 fingerprint stored in existing `Integration.config` JSON, queried with `config contains "secretFingerprint":"<hash>"`, then timing-safe compare on at most two rows |
| WhatsApp `phone_number_id` | `config contains "phoneNumberId":"<id>"`, then exact match on at most five rows |

`organizationId` is applied only when the caller already has a trusted server context. Webhook bodies are never used as tenant context.

Secrets are not returned by `toPublicIntegration`, not logged (`logSecurity` redacts secret/token keys), and not included in error JSON.

Saving an integration (`updateIntegrationAction`) stamps `secretFingerprint` into `config`. Existing agencies must **save Settings once** before secret-header callers (n8n, website ingest, Meta GET verify) resolve. Meta **POST** does not need that re-save; it looks up `phoneNumberId`, which was already stored.

---

## Signature verification (S3)

Algorithm already in the repo: `verifyMetaSignature` — HMAC-SHA256 of the **raw body**, header value `sha256=<hex>`.

Custom inbound headers:

- `x-revivelead-integration` — public integration id (shown on Settings)
- `x-revivelead-signature` or `x-hub-signature-256` — HMAC of the raw JSON body

Order:

1. Read raw body
2. Parse JSON only to classify Meta vs custom and to read `phone_number_id`
3. Resolve the integration from a request identifier (header id or phone number id)
4. Verify HMAC
5. Only then write leads / messages

Rejected before any mutation:

| Case | Status | Body |
|---|---|---|
| Unknown / missing integration | 401 | `{ error: "Unknown integration" }` |
| Missing signature | 401 | `{ error: "Missing signature" }` |
| Invalid / wrong-secret / tampered body | 401 | `{ error: "Invalid signature" }` |
| Invalid JSON | 400 | `{ error: "Invalid JSON" }` |
| Invalid custom fields after a valid signature | 400 | `{ error: "Invalid payload" }` |

A shared secret in `x-revivelead-secret`, `x-api-key`, query string, or the JSON body is **not** accepted as custom-inbound authentication.

---

## Replay / idempotency

| Source | Identifier | Behavior |
|---|---|---|
| Meta messages | `messages[].id` | Existing `LeadMessage.providerId` dedupe (org-scoped). Duplicate delivery returns `duplicate: true` and does not create a second message |
| Custom inbound | optional `eventId` / `providerId` / `id` | Same `providerId` path, plus `WebhookEvent` claim `inbound:<organizationId>:<eventId>` after a successful first write |
| Custom inbound without an event id | none | Processed normally. **Not rejected** — inventing a timestamp window would drop legitimate events |
| Paddle / Razorpay | existing `WebhookEvent` unique `(provider, eventId)` | Unchanged |

No new table. `WebhookEvent` already exists.

---

## Provider-specific assumptions

- **Meta WhatsApp:** `x-hub-signature-256` over the raw body using the agency’s stored webhook secret; subscribe handshake uses `hub.verify_token` in the query string (Meta spec). Tenant is selected by `metadata.phone_number_id`, then confirmed by the signature. `organizationId` in a payload is ignored.
- **Custom inbound:** same HMAC convention as Meta. Integration id is a public locator, not a secret.
- **n8n / website ingest:** still use the existing shared-secret header contract. This PR does not add n8n features or change those routes beyond making `resolveOrgFromSecret` targeted.
- **Paddle / Razorpay:** already signed; not modified.

---

## Files changed

New:

- `frontend/src/lib/integrations/lookup.ts`
- `frontend/src/lib/webhooks/inbound-auth.ts`
- `frontend/tests/phase1c.test.ts`
- `docs/PHASE_1C_WEBHOOK_SECURITY.md`

Modified:

- `frontend/src/lib/org.ts`
- `frontend/src/lib/whatsapp/inbound.ts`
- `frontend/src/lib/whatsapp/config.ts`
- `frontend/src/app/api/webhooks/inbound/route.ts`
- `frontend/src/actions/settings.ts`
- `frontend/src/lib/log.ts`
- `frontend/src/components/settings-forms.tsx` (shows existing integration id; no layout redesign)

Not modified: Razorpay route, n8n route, Paddle route, Prisma schema.

---

## Migrations

**Not required.**

The Integration model already has a primary key (used as the custom-inbound locator) and a JSON `config` string (used for `secretFingerprint` and `phoneNumberId`). A new unique `secretHash` column would be cleaner at very large tenant counts, but it is not required to stop loading every integration into Node.

---

## Tests added

`frontend/tests/phase1c.test.ts`

- Correct integration resolves by fingerprint
- Unrelated integrations are queried only via `config contains` + `take: 2`
- Wrong organization cannot resolve another org’s integration / secret / phone number
- Missing integration fails closed
- Valid custom HMAC accepted; body `organizationId` ignored
- Missing, invalid, modified, and wrong-secret signatures rejected with no writes
- Secret header alone rejected
- Duplicate `eventId` does not create a second message
- Valid Meta HMAC accepted; missing / tampered Meta rejected
- Meta GET verify succeeds / fails without echoing the token
- Org B credentials cannot write Org A leads
- Secrets never appear in JSON / text responses

---

## Validation results

Run from `frontend/` on 2026-08-23:

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` | Pass — 9 files, **79/79** tests |
| `npm run build` | Pass — Next.js 16.3.1 production build |

---

## Remaining security issues (not in this PR)

- S4 / P7 follow-up assignee check
- S5 import preview role alignment
- S8 billing cancel snapshot honesty
- S9 chat route must not fake success
- P1 intelligence unbounded query
- A1 Auth.js pages when Clerk is on
- Confirm Data API is off in the live Supabase dashboard
- Confirm cron hits `/api/cron/follow-ups` with `CRON_SECRET`
- n8n / website ingest still authenticate with a shared secret header (existing contract)
- Integrations saved before this PR need one Settings save so `secretFingerprint` exists
- Razorpay / n8n product work and RLS remain out of scope
