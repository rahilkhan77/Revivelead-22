# Phase 1B implementation

**Date:** 2026-08-23  
**Scope:** First backend fixes from `docs/PHASE_1_BACKEND_AUDIT.md`. No Razorpay, n8n, RLS migration, or frontend redesign.

---

## Supabase Data API finding

ReviveLead does **not** use the Supabase Data API. Disabling it is safe. **No database policies were changed.**

Checked:

| Check | Result |
|---|---|
| `@supabase/supabase-js` | Not in dependencies |
| `createClient` / generated Supabase clients | None |
| Browser / REST `/rest/v1` / RPC | None |
| App data path | Prisma only (`src/lib/db.ts` + `DATABASE_URL`) |
| `SUPABASE_*` env vars | Documented unused in `.env.example` and `docs/PRODUCTION.md` |
| Service-role in the client bundle | None |

Prisma talks to Postgres over `DATABASE_URL`. No application code path would break if the Data API is turned off.

**Do not enable RLS from this finding.** All Prisma tables currently have RLS off. Enabling it without a migration plan would block the app.

Ops should still confirm in the Supabase dashboard that `public` is not exposed through PostgREST. That is infrastructure, not an application change.

---

## Property CRUD

The existing `Property` model already has the required fields. **No schema migration.**

Org-scoped service methods and server actions were added, then the existing `/properties` page (same header, cards, empty state) was wired to real create / update / delete.

| Operation | Implementation |
|---|---|
| CREATE | `createProperty` / `createPropertyAction` |
| READ LIST | `listProperties` / page + `listPropertiesAction` |
| READ SINGLE | `getProperty` / `getPropertyAction` |
| UPDATE | `updateProperty` / `updatePropertyAction` — `updateMany({ id, organizationId })` |
| DELETE | `deleteProperty` / `deletePropertyAction` — `deleteMany({ id, organizationId })` |

Rules:

- Auth via `withUser()` / `requireUser()` (Clerk in production, Auth.js locally)
- `organizationId` comes from the session only
- Zod validation on the server (`propertyInputSchema`)
- Linked leads must belong to the same org
- Empty organization or missing id is rejected
- Cross-org get / update / delete return not found

---

## Email fail-closed

`src/lib/messaging/email.ts` no longer returns demo / `queued_*` success.

| Case | Result |
|---|---|
| Transport confirms with an id | `ok: true` |
| Transport rejects, throws, or times out | `ok: false` + error |
| Agency email integration missing or disabled | `ok: false` — not configured |
| Invalid recipient or empty body | `ok: false` |
| Transport returns `ok` without an id | `ok: false` — not confirmed |

The `EmailProvider` abstraction is unchanged (`send(OutboundMessage) → SendResult`). Tests inject `loadConfig` and `transport`. Production delivery uses Resend only when `RESEND_API_KEY` is set. An SMTP host on the integration is treated as “configured,” but send still fails closed unless a real transport confirms.

Transactional Resend (`src/lib/email/resend.ts`) was already fail-closed in production and was not changed.

---

## organizationId on updates

Mutations that found a tenant row then updated by `id` only now use `updateMany` / `deleteMany` with server-resolved `organizationId` (or `campaign: { organizationId }` for recipients).

Touched:

- Leads: `src/actions/leads.ts`, `src/lib/leads/service.ts`, `src/actions/import.ts`
- Follow-ups: `src/actions/follow-ups.ts`, `src/lib/follow-up/engine.ts`
- Campaigns / reactivation: `src/actions/campaigns.ts`
- Team: `src/actions/team.ts`
- Automations: `src/actions/automations.ts`, `src/lib/automations/engine.ts`
- Settings integrations: `src/actions/settings.ts`
- API keys last-used: `src/lib/api-keys.ts`
- Chat sessions: `src/lib/chat/engine.ts`
- Properties: `src/lib/properties/service.ts`

Helper: `src/lib/tenant.ts` (`ownedId`, `assertMutated`).

No client-supplied `organizationId` is trusted.

Left as-is (already tenant-keyed or identity, not the S1 pattern):

- `organization.update({ where: { id: user.organizationId } })`
- `subscription.update({ where: { organizationId: user.organizationId } })`
- password-reset `user.update({ where: { email } })`
- invitation accept after unique token lookup

Revenue events are created, not updated. Lead `revenueAtRisk` writes now use org-scoped `updateMany`.

---

## Files changed

New:

- `frontend/src/lib/tenant.ts`
- `frontend/src/actions/properties.ts`
- `frontend/src/components/property-inventory.tsx`
- `frontend/tests/phase1b.test.ts`
- `docs/PHASE_1B_IMPLEMENTATION.md`

Modified:

- `frontend/src/lib/properties/service.ts`
- `frontend/src/app/(app)/properties/page.tsx`
- `frontend/src/lib/messaging/email.ts`
- `frontend/src/actions/leads.ts`
- `frontend/src/actions/follow-ups.ts`
- `frontend/src/actions/campaigns.ts`
- `frontend/src/actions/team.ts`
- `frontend/src/actions/automations.ts`
- `frontend/src/actions/settings.ts`
- `frontend/src/actions/import.ts`
- `frontend/src/lib/leads/service.ts`
- `frontend/src/lib/follow-up/engine.ts`
- `frontend/src/lib/automations/engine.ts`
- `frontend/src/lib/chat/engine.ts`
- `frontend/src/lib/api-keys.ts`

---

## Database migrations

**None required. None created.**

---

## Tests added

`frontend/tests/phase1b.test.ts`

- Property create / list / get / update / delete
- Unauthorized (missing organization)
- Cross-organization property get / update / delete
- Cross-organization lead status update + raw `updateMany` / `deleteMany`
- Email success, provider failure, missing config, invalid input, unconfirmed send

Suite total after this work: **70 passed** (was 61).

---

## Validation results

Run from `frontend/` on 2026-08-23:

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` | Pass — 8 files, **70/70** tests |
| `npm run build` | Pass — Next.js 16.3.1 production build, `/properties` compiled |

The properties UI was not clicked in a browser in this pass (no browser automation available). Closest substitute: the production build compiled the route, and service-level CRUD / isolation tests passed.

---

## Remaining Phase 1 issues (not in this PR)

From the audit, still open:

- Confirm Data API is off in the live Supabase dashboard (ops)
- S2 secret scan in `resolveOrgFromSecret`
- S3 custom inbound webhook HMAC
- S4 / P7 follow-up complete assignee check + toast
- P1 intelligence unbounded lead load
- A1 Auth.js pages reachable when Clerk is on
- Lead field-edit UI still unwired (`updateLeadAction` exists)
- Team role UI still unwired (`updateMemberRoleAction` exists)
- Inbox / follow-up pagination
- Cron scheduler confirmation (ops)
- Chat route must not fake success (S9)
- Billing cancel snapshot honesty (S8)
- Drop unused `Agent` model (later migration)
- Razorpay / n8n / RLS (explicitly out of scope)

---

## DONE

- Confirmed Data API is unused; no RLS or policy changes
- Property CRUD (create, list, get, update, delete) with org scope
- Existing properties page wired to the real backend
- Email messaging fail-closed
- Tenant `organizationId` retained on updates / deletes
- Tests added (70/70)
- typecheck, lint, test, and build all pass
- No migration

## REMAINING

- Webhook secret lookup and inbound signatures (S2 / S3)
- Intelligence query scale (P1)
- Follow-up assignee rules / complete toast (S4 / P7)
- Auth.js redirect when Clerk is on (A1)
- Lead edit UI and team role UI
- Ops: confirm Data API off in Supabase; confirm cron

## NEXT RECOMMENDED STEP

Confirm in the Supabase dashboard that the Data API does not expose `public`, then implement inbound webhook signatures and stop scanning all integration secrets (`S2` / `S3`).
