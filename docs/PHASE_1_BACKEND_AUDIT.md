# Phase 1 backend audit

**Date:** 2026-08-23  
**Scope:** `frontend/` only. Read-only audit. No architecture change, no migrations, no Razorpay work, no n8n work.  
**Product constraint:** ReviveLead is a single Next.js app. Prisma talks to PostgreSQL (hosted on Supabase). Clerk is production auth. Auth.js remains the local fallback.

---

## A. Current architecture

ReviveLead is one Next.js App Router application (`frontend/`). There is no separate backend service.

```
Browser
  → Next.js (RSC pages + client components)
    → proxy.ts (Clerk / Auth.js edge gate)
      → Server Actions (src/actions/*) or Route Handlers (src/app/api/*)
        → withUser() / requireUser() / resolveOrgFromRequest()
          → domain services (src/lib/*)
            → Prisma client (src/lib/db.ts)
              → PostgreSQL (Supabase host, Prisma connection string)
```

| Layer | Location | Role |
|---|---|---|
| Edge / middleware | `frontend/src/proxy.ts` | Session gate, auth rate limits, Clerk FAPI proxy (`/__clerk` when `pk_live_`) |
| App shell | `frontend/src/app/(app)/layout.tsx` | `requireUser()`, onboarding redirect |
| Server actions | `frontend/src/actions/*.ts` | Authenticated mutations |
| API routes | `frontend/src/app/api/**/route.ts` | Ingest, search, cron, webhooks, widget chat, Auth.js |
| Domain | `frontend/src/lib/**` | Leads, follow-ups, automations, billing, messaging, AI |
| Data | `frontend/src/lib/db.ts` + Prisma schemas | Single Prisma client; no Supabase JS client |

Vercel Root Directory is `frontend`. Local Prisma provider is SQLite (`prisma/schema.prisma`). Production provider is PostgreSQL (`prisma/postgres/schema.prisma`), swapped at build by `scripts/prepare-prisma.mjs`.

---

## B. Authentication architecture

### Dual stack

| Mode | Trigger | Entry pages | Session source |
|---|---|---|---|
| **Clerk (production)** | `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` both set (`isClerkEnabled()` in `src/lib/auth/clerk.ts`) | `/sign-in`, `/sign-up`, Google SSO via `signIn.sso()` / `signUp.sso()` | `@clerk/nextjs/server` `auth()` + `currentUser()` |
| **Auth.js fallback (local)** | Clerk keys missing | `/login`, `/signup`, `/forgot-password`, `/reset-password` | JWT session from `src/auth.ts` credentials provider |

`getSessionUser()` in `src/lib/authz.ts` is wrapped in React `cache()`. Clerk path: `clerkId` → `resolveExistingClerkUser()` → else `resolveClerkToAppUser()` which creates `User` + `provisionOrganization()`. Auth.js path: JWT must contain `id` and `organizationId`.

`requireUser()` redirects to `/sign-in` (Clerk) or `/login` (Auth.js). `withUser()` in `src/lib/safe-action.ts` throws `AuthError` and applies per-user rate limits.

### Edge protection (`src/proxy.ts`)

Protected UI: `/dashboard`, `/leads`, `/follow-ups`, `/reactivation`, `/team`, `/revenue`, `/automations`, `/settings`, `/billing`, `/inbox`, `/onboarding`, `/intelligence`, `/import`, `/properties`.

Public at the edge (route-level auth still required): `/api/webhooks(.*)`, `/api/cron(.*)`, `/api/chat(.*)`, `/api/ingest(.*)`, `/api/auth(.*)`.

`/api/leads` and `/api/search` are **not** edge-protected; they authenticate inside the handler.

### Onboarding gate

`(app)/layout.tsx` reads `x-revivelead-path` (set by `proxy.ts`). If `!onboardingCompleted && !isDemo`, users are sent to `/onboarding` except `/onboarding`, `/leads/import`, `/import`, `/team`.

### Session / org mapping

Clerk user → Prisma `User.clerkId` → first `Membership` (`take: 1`) → `organizationId` + `role`.  
App roles live in `Membership`, not Clerk Organizations. No org switcher.

### Findings (auth)

| ID | File / function | Problem | Why it matters | Recommended fix | Migration? | Priority |
|---|---|---|---|---|---|---|
| A1 | `src/app/login/page.tsx`, `src/app/signup/page.tsx` | Auth.js pages stay reachable when Clerk is on | Parallel login stack can create password users beside Clerk | Redirect `/login` `/signup` `/reset-password` to Clerk routes when `isClerkEnabled()` | No | MEDIUM |
| A2 | `src/lib/auth/provision-clerk.ts` `resolveExistingClerkUser` and `src/auth.ts` JWT callback | First unordered membership wins | Multi-org user would see the wrong agency | Persist `activeOrganizationId` and add a switcher only if multi-org is a product requirement | Yes, if multi-org is required | HIGH (only if multi-org is in scope) |
| A3 | `src/app/(app)/layout.tsx` | Onboarding gate no-ops when `x-revivelead-path` is empty | Direct RSC without the proxy header can skip the redirect | Fall back to `headers().get("x-pathname")` or `next/headers` path, or always compute from the request | No | LOW |
| A4 | `src/components/providers.tsx` | `ThemedClerkProvider` always mounts | Harmless when keys exist; confusing if Clerk is off locally | Mount Clerk provider only when `clerkEnabled` | No | LOW |

---

## C. Database architecture

| Item | Status |
|---|---|
| Client | Single `PrismaClient` on `globalThis` (`src/lib/db.ts`) |
| Local | SQLite `file:./dev.db` |
| Production | PostgreSQL via `DATABASE_URL` only |
| `DIRECT_URL` | Not in schema. Unused. |
| `SUPABASE_*` | Documented as unused. No `@supabase/supabase-js`. No REST `/rest/v1` calls. |
| Pooling | `prismaDatasourceUrl()` rewrites Supabase session pooler `:5432` → transaction `:6543`, sets `pgbouncer=true`, `connection_limit=5`, `pool_timeout=20`, `sslmode=require` |
| Migrations | One init migration: `prisma/postgres/migrations/20260815170000_init` |
| Lifecycle | Correct serverless singleton. No extra `new PrismaClient()` in app code |

**Correct access path:** Prisma → Postgres connection string. Not the Supabase Data API. Not Supabase Auth.

---

## D. Multi-tenancy model

Tenant key is `Organization.id` (`organizationId` on tenant tables).

Resolution paths:

| Source | Function | File |
|---|---|---|
| Signed-in user | `getSessionUser().organizationId` | `src/lib/authz.ts` |
| API key | `resolveOrgFromApiKey()` | `src/lib/api-keys.ts` |
| Integration secret | `resolveOrgFromSecret()` | `src/lib/org.ts` |
| Combined | `resolveOrgFromRequest()` | `src/lib/api-auth.ts` |
| Chat widget | `Organization.widgetKey` | `src/app/api/chat/route.ts` |
| WhatsApp Meta | phone number ID + HMAC | `src/lib/whatsapp/inbound.ts` |
| Billing webhooks | subscription / customer IDs | `src/app/api/webhooks/razorpay`, `paddle` |

Lead visibility:

```ts
// src/lib/leads/service.ts leadVisibilityWhere
{ organizationId, ...(canSeeAll ? {} : { assignedAgentId: userId }) }
```

Managers (`OWNER`, `ADMIN`, `SALES_MANAGER`) see all org leads. `SALES_AGENT` sees assigned leads only.

**No confirmed cross-tenant read/write** was found when the session or API credential is valid. Isolation is application-layer, not Postgres RLS.

---

## E. Security findings

### Tenant queries

Most page queries and creates include `organizationId`. Several **updates** do a scoped `findFirst` then `update({ where: { id } })`. That is safe today if the find stays correct; it is not defense-in-depth.

| ID | File / function | Problem | Why it matters | Recommended fix | Migration? | Priority |
|---|---|---|---|---|---|---|
| S1 | `src/actions/leads.ts` `updateLeadAction`, `assignLeadAction`; `src/actions/follow-ups.ts` `completeFollowUpAction`, `sendFollowUpNowAction`; `src/actions/campaigns.ts` recipient/campaign updates; `src/actions/team.ts` `updateMemberRoleAction` | `update({ where: { id } })` after org-scoped find | A future regression in the find would write another tenant’s row | Add `organizationId` (and lead visibility) to every update/delete `where` | No | HIGH |
| S2 | `src/lib/org.ts` `resolveOrgFromSecret` | Loads **all** enabled integrations of given types, then compares secrets in JS | Grows with tenant count; colliding secrets route traffic to the first match | Store a hashed lookup key, or query by a unique secret fingerprint | No | HIGH |
| S3 | `src/app/api/webhooks/inbound/route.ts` custom POST path (lines 101–121) | Shared secret header only; no HMAC | Anyone with a leaked integration secret can inject inbound messages | Require a signature for custom inbound, same as Meta | No | HIGH |
| S4 | `src/actions/follow-ups.ts` `completeFollowUpAction` | Org-scoped, not assignee-scoped | Agents can complete other agents’ follow-ups in the same agency | Require manager **or** `assignedToId === user.id` | No | MEDIUM |
| S5 | `src/actions/import.ts` `previewCsvAction` | Any authenticated user can preview CSV | Weaker than Import Center (`ADMIN_ROLES`) | Require admin, or keep `/leads/import` as agent self-import but document it | No | MEDIUM |
| S6 | `src/app/api/leads/route.ts` GET | API-key callers get all org leads (`canSeeAll = true` when no matching session) | Intentional for integrations; keys are org-wide | Keep; treat API keys as full-org secrets | No | LOW |
| S7 | `src/app/api/cron/follow-ups/route.ts` | Global worker across all orgs | Correct for cron; catastrophic if `CRON_SECRET` leaks | Keep fail-closed in production (`requireCronSecret`) | No | LOW (ops) |
| S8 | `src/actions/billing.ts` `cancelSubscriptionAction` | Razorpay snapshot `catch` returns `ok()` | UI can show cancel succeeded while DB snapshot is stale | Return a warning or refresh-from-webhook message; do not pretend snapshot applied | No | MEDIUM |
| S9 | `src/app/api/chat/route.ts` | Catch returns a fake successful chat reply | Widget hides outages | Return 500 with a generic message; do not invent a successful turn | No | MEDIUM |

### Client secrets

No `NEXT_PUBLIC_` service-role or database credentials. Clerk publishable key is public by design. Razorpay/Paddle/Clerk secrets are server-only.

---

## F. Supabase / RLS findings

### How this app actually uses Supabase

Supabase is **hosted PostgreSQL** only.

- No `@supabase/supabase-js`
- No `createClient`
- No `SUPABASE_SERVICE_ROLE` / `SUPABASE_SECRET_KEY` usage in application code
- `.env.example` states the app does not read `SUPABASE_*`
- All reads/writes go through Prisma with `DATABASE_URL`

Prisma connects as the database role in `DATABASE_URL` (typically the project `postgres` role). That role **bypasses RLS**. Application authorization (`requireUser`, `leadVisibilityWhere`, role checks) is the real tenant boundary.

### Which tables have RLS disabled

The committed migration `prisma/postgres/migrations/20260815170000_init/migration.sql` does **not** contain `ENABLE ROW LEVEL SECURITY` or any `CREATE POLICY`. Every Prisma table is created in `public` with RLS off:

`User`, `Account`, `Session`, `VerificationToken`, `Organization`, `Membership`, `Invitation`, `Agent`, `Lead`, `LeadMessage`, `FollowUp`, `Automation`, `AutomationExecution`, `Campaign`, `CampaignRecipient`, `Property`, `Notification`, `Subscription`, `Integration`, `RevenueEvent`, `AuditLog`, `ApiKey`, `ImportHistory`, `ChatSession`, `ChatMessage`, `WebhookEvent`

The Security Advisor warning is therefore **expected**. It is not a single forgotten table in application code. If the dashboard highlights one name, it is still the same class of issue: a `public` table exposed to PostgREST with RLS off.

Highest-sensitivity if the Data API can see them: `User.passwordHash`, `ApiKey.keyHash`, `Integration.config` (WhatsApp tokens, webhook secrets), `Subscription` provider IDs, all lead PII, `AuditLog`.

`WebhookEvent` is the odd table (no `organizationId`). If Data API is on, it is globally readable.

This audit cannot see the live Supabase project from git. Confirm in the dashboard: **Settings → API → Exposed schemas** and **Authentication → Policies**.

### Correct security strategy (do not blindly enable RLS)

1. **Keep Prisma as the only application data path.** Do not add the Supabase JS client.
2. **Turn off the Supabase Data API for `public`**, or remove `public` from exposed schemas. That is the fix that matches this architecture. The advisor warning exists because PostgREST can see tables the Next.js app never uses through PostgREST.
3. **Do not enable RLS just to silence the advisor** while `DATABASE_URL` still uses the `postgres` owner role. Prisma will keep bypassing RLS. You would add operational risk (broken queries if the role ever loses `BYPASSRLS`) without changing the app’s real threat model.
4. If Data API must stay on (it should not), then enable RLS **and** add deny-by-default policies on every table, and never put the service role in a browser bundle. That is a different product architecture than ReviveLead today.
5. Keep the database network restricted to the Vercel/Prisma connection. Rotate `DATABASE_URL` if it was ever pasted into a client or screenshot.

**Do not create a migration to enable RLS in Phase 1.**

| ID | File / function | Problem | Why it matters | Recommended fix | Migration? | Priority |
|---|---|---|---|---|---|---|
| D1 | Supabase project (infra), not app code | All Prisma tables have RLS off; Data API may expose them | Advisor warning; theoretical public REST access to agency data | Disable Data API / unexpose `public`. Verify in dashboard. Do not add RLS policies in Prisma yet | No | CRITICAL (infra verify) |

---

## G. Core feature status

Status means “wired end-to-end to Prisma for a signed-in org,” not “production messaging provider configured.”

| # | Module | Status | Evidence |
|---|---|---|---|
| 1 | Authentication | **Working** | Clerk custom UI + Google SSO; Auth.js local fallback; `proxy.ts` protect |
| 2 | Onboarding | **Working** | `OnboardingWizard` → `src/actions/onboarding.ts` → `Organization` |
| 3 | Dashboard | **Working** | `getDashboardMetrics()` Prisma aggregates + recent leads |
| 4 | Leads CRUD | **Partially working** | Create/read/status/qualify work. `updateLeadAction` exists, **no edit UI**. No delete |
| 5 | Lead assignment | **Working** | `assignLeadAction` + ingest round-robin `assignNextAgent()` |
| 6 | Lead search/filter | **Working** | `/leads` query params + `GET /api/search` (take 8) |
| 7 | CSV/Excel import | **Partially working** | `/import` admin Excel+CSV; `/leads/import` CSV-only, weaker auth; sequential ingest up to 2000 rows |
| 8 | Follow-ups | **Partially working** | Engine + cron + UI. Sends use WhatsApp/email providers (demo if unconfigured). Complete button swallows errors |
| 9 | Reactivation | **Partially working** | Campaigns persist. Cap 50 recipients. Sequential AI. Sends demo without WhatsApp |
| 10 | Inbox | **Partially working** | List of leads with messages (`take: 40`). Threads live on `/leads/[id]` |
| 11 | Properties | **Mock/incomplete** | Read-only page (`take: 50`). Chat `searchProperties()` is real Prisma. **No create/update/delete UI or actions.** Seed is the only practical writer |
| 12 | Revenue Recovery | **Working** | `RevenueEvent` on WON / reactivated-won; `/revenue`, dashboard, intelligence |
| 13 | Team | **Partially working** | Invite works. `updateMemberRoleAction` **not wired**. No remove member |
| 14 | Automations | **Working** | CRUD + `runAutomations()` from ingest/status/follow-up |
| 15 | Settings | **Working** | Org, integrations, API keys, local plan switch |
| 16 | Billing | **Partially working** | Razorpay/Paddle code exists. Out of Phase 1 scope for live integration. Local `changePlanAction` placeholder when no provider. Demo org blocked |

### Demo / placeholder layers (UI is real; providers may be fake)

| Layer | File | Behavior |
|---|---|---|
| WhatsApp | `src/lib/messaging/whatsapp.ts` | Demo send when integration disabled or missing creds (non-prod) |
| Email messaging | `src/lib/messaging/email.ts` | Logs `[email-demo]` without SMTP. **With SMTP configured, still returns `queued_*` and never sends** |
| AI | `src/lib/ai/provider.ts` | Heuristic provider if no OpenAI/Puter key |
| Billing | `src/actions/settings.ts` `changePlanAction` | Local plan switch when payment provider off |
| Al Noor | `Organization.isDemo` | Seed tenant; skips onboarding and billing |

There is no `TODO`/`FIXME` in `src/`. Heuristic AI copy mentions “Al Noor Properties” in fallback text.

---

## H. API / server action status

### Server actions (`src/actions/`)

| File | Auth | Validation | Notes |
|---|---|---|---|
| `auth.ts` | Public + rate limit | Zod-ish field checks | Auth.js only |
| `leads.ts` | `withUser()` | Zod `leadSchema` | Update unused in UI |
| `follow-ups.ts` | `withUser()`; engine is manager | Dates / IDs | Complete not assignee-scoped |
| `import.ts` | `withUser({ policy: "upload" })` | File type/size; row re-validation on confirm | Dual paths |
| `campaigns.ts` | `withUser()` + manager | Segment + message | 50-recipient cap; N+1 AI |
| `automations.ts` | `withUser()` + manager | Config JSON | Plan limit on create |
| `team.ts` | `withUser()` + manager/admin | Invite role schema | Role update unused |
| `settings.ts` | `withUser()` + admin/owner | Org/integration fields | |
| `onboarding.ts` | `withUser()` + admin | | |
| `billing.ts` | `withUser({ policy: "billing" })` + owner | | Do not expand in Phase 1 |
| `api-keys.ts` | `withUser()` + admin | | |

### API routes

| Route | Auth | Org scope |
|---|---|---|
| `GET/POST /api/leads` | API key / secret / session | Yes |
| `GET /api/search` | Session | `leadVisibilityWhere` |
| `POST /api/ingest/leads` | API key / secret / session | `ingestLead` |
| `POST /api/ingest/website` | Integration secret | `ingestLead` |
| `POST /api/chat` | `widgetKey` | Org from widget key |
| `GET /api/cron/follow-ups` | `CRON_SECRET` | All orgs (worker) |
| `GET/POST /api/webhooks/inbound` | Meta HMAC or shared secret | Resolved org |
| `POST /api/webhooks/n8n` | N8N/WEBHOOK secret | Present; **do not expand** |
| `POST /api/webhooks/razorpay` | HMAC | **Do not touch** |
| `POST /api/webhooks/paddle` | Signature | Fallback only |
| `GET/POST /api/auth/[...nextauth]` | Auth.js | Local fallback |

### API / action issues

| ID | File / function | Problem | Why it matters | Recommended fix | Migration? | Priority |
|---|---|---|---|---|---|---|
| P1 | `src/lib/intelligence/metrics.ts` `getIntelligenceMetrics` | Loads **all** org leads into memory | Breaks as lead volume grows | `groupBy` / aggregates in SQL | No | HIGH |
| P2 | `src/actions/import.ts` `confirmImportAction` | Sequential `findDuplicateLead` + `ingestLead` per row | Slow imports; pool pressure | Batch duplicate lookup; keep row cap | No | MEDIUM |
| P3 | `src/actions/campaigns.ts` create/send | Sequential AI + send, max 50 | Latency; incomplete campaigns | Keep cap; later queue | No | MEDIUM |
| P4 | `src/app/(app)/inbox/page.tsx` | `take: 40`, no pagination | Older threads disappear | Cursor pagination | No | MEDIUM |
| P5 | `src/app/(app)/follow-ups/page.tsx` | `take: 80` | Same | Pagination | No | MEDIUM |
| P6 | `src/lib/metrics.ts` `getTeamPerformance` | Up to 2000 lead touches | Heavy team page | Aggregate in SQL | No | MEDIUM |
| P7 | `src/components/follow-up-actions.tsx` Complete | Ignores `result.ok` | Silent failure | Toast on `!result.ok` | No | MEDIUM |
| P8 | `src/lib/messaging/email.ts` `EmailProvider.send` | SMTP config still does not send | Settings imply email works | Implement nodemailer/Resend **or** return `ok: false` until implemented | No | HIGH |
| P9 | Duplicate `getSessionUser` on layout + page | Deduped by React `cache()` | Not a bug | Keep | No | — |

---

## I. Data model status

Production schema: `frontend/prisma/postgres/schema.prisma` (mirrors local SQLite schema).

| Domain | Model | Used? | Notes |
|---|---|---|---|
| Agencies | `Organization` | Yes | Settings JSON, `isDemo`, `onboardingCompleted`, `widgetKey` |
| Users | `User` | Yes | `clerkId`, optional `passwordHash` |
| Auth.js leftovers | `Account`, `Session`, `VerificationToken` | Auth.js only | Fine to keep |
| Team | `Membership`, `Invitation` | Yes | App agents are memberships |
| Dead model | `Agent` | **Seed delete only** | Unused at runtime |
| Leads | `Lead` | Yes | Indexes on org + status/agent/phone/email |
| Messages | `LeadMessage` | Yes | `organizationId` denormalized; **no Organization FK** |
| Follow-ups | `FollowUp` | Yes | `assignedToId` has **no User FK** |
| Campaigns | `Campaign`, `CampaignRecipient` | Yes | `createdById` no User FK; no `@@unique([campaignId, leadId])` |
| Properties | `Property` | Read + chat search | No app writer except import type stub |
| Revenue | `RevenueEvent` | Yes | `type` is a free string |
| Automations | `Automation`, `AutomationExecution` | Yes | |
| Billing | `Subscription` | Yes | Do not change in this phase |
| Settings | `Integration` | Yes | Secrets in `config` JSON |
| Notifications | `Notification` | Write + unread dot | No notification list UI |
| Audit | `AuditLog` | Write-only | No admin reader |
| Keys / import | `ApiKey`, `ImportHistory` | Yes | |
| Chat widget | `ChatSession`, `ChatMessage` | Yes | |
| Webhooks | `WebhookEvent` | Idempotency | No org column |
| Unified activity | — | **Missing** | Messages + follow-ups + audit are separate. Only add if a single timeline is required |

### Required schema changes (report only — do not migrate now)

| Change | Why | Priority |
|---|---|---|
| Drop or wire `Agent` | Dead table; advisor/noise | LOW |
| FK `FollowUp.assignedToId` → `User` | Orphan assignees | LOW |
| FK `Campaign.createdById` → `User` | Integrity | LOW |
| `@@unique([campaignId, leadId])` on `CampaignRecipient` | Duplicate recipients | MEDIUM |
| FK `LeadMessage.organizationId` → `Organization` | Integrity | LOW |
| `User.activeOrganizationId` | Only if multi-org is a product requirement | HIGH if scoped, else skip |
| Unified `Activity` | Only if product wants one feed | Optional |

None of these block current single-agency Clerk + Prisma flows.

---

## J. Performance status

The 15–25s request-amplification work is **still intact**. Do not undo it.

| Optimization | Status | Location |
|---|---|---|
| Clerk/session user cached per RSC request | Intact | `getSessionUser` / org helpers use React `cache()` in `src/lib/authz.ts` |
| SessionProvider refetch disabled | Intact | `refetchOnWindowFocus={false}`, `refetchInterval={0}`; provider skipped when Clerk is on (`src/components/providers.tsx`) |
| Sidebar prefetch disabled | Intact | `prefetch={false}` on every nav `Link` (`src/components/app-shell.tsx`) |
| Debug localhost fetches | Absent | No `fetch` to `localhost:3000`. Remaining localhost strings are URL fallbacks for emails/invites |
| Dashboard query consolidation | Intact | `getDashboardMetrics()` — 8 queries in one `Promise.all`; page adds recent leads in parallel |
| Intelligence parallelization | Intact | 5 queries in `Promise.all` — **but** the lead query is unbounded (see P1) |
| Connection pooling | Intact | `prismaDatasourceUrl()` + `tests/db.test.ts` |

`proxy.ts` still calls Clerk `auth()` on the edge once per protected request. That is expected and is not the old RSC amplification loop.

Minor leftover: billing page can fetch subscription twice (`getBillingUsage` + page query). Low impact.

---

## K. Critical bugs

Nothing in application code currently reproduces a confirmed **cross-tenant data leak** or a dashboard P2024/EMAXCONNSESSION (those were fixed in `d4f4795` / `d1e5845`).

The only **CRITICAL** item is infra, not a code bug:

1. **Supabase Data API + RLS-off public tables** — verify the Data API is disabled. If it is enabled, agency PII is theoretically reachable outside Prisma. File: Supabase dashboard, not a source file. Migration: no.

No other CRITICAL application defects were found in this pass.

---

## L. High-priority fixes

Do these next. Still no Razorpay, no n8n, no redesign.

| ID | Item | Priority |
|---|---|---|
| D1 | Verify/disable Supabase Data API | CRITICAL / first action |
| P8 | Email provider either sends or fails closed | HIGH |
| Properties | Add org-scoped property create/update/delete (actions + existing page, no redesign) | HIGH |
| S1 | Put `organizationId` on Prisma updates/deletes | HIGH |
| S2 | Stop scanning all integration secrets | HIGH |
| S3 | Sign custom inbound webhooks | HIGH |
| Leads | Wire `updateLeadAction` on lead detail (edit existing fields) | HIGH |
| P1 | Intelligence SQL aggregates | HIGH |
| Cron | Confirm production scheduler hits `GET /api/cron/follow-ups` with `CRON_SECRET` | HIGH (ops) |
| Messaging | Document that WhatsApp/email are demo until integration credentials are saved | HIGH (ops) |

---

## M. Medium-priority fixes

| ID | Item |
|---|---|
| A1 | Redirect Auth.js pages when Clerk is enabled |
| S4 / P7 | Follow-up complete: assignee check + toast |
| S5 | Align `/leads/import` admin policy with Import Center |
| S8 | Billing cancel snapshot error handling |
| S9 | Chat route must not fake success |
| P2–P6 | Import/campaign/inbox/follow-up/team query limits |
| Team | Wire `updateMemberRoleAction`; add remove/deactivate |
| Inbox | Real thread list + pagination |
| `CampaignRecipient` unique constraint | When a migration is eventually allowed |
| A2 | Multi-org only if product requires it |

---

## N. Optional improvements

- Notification list UI (writes already exist)
- Audit log viewer
- Lead delete (with org scope + audit)
- Unified `Activity` timeline
- Drop unused `Agent` model
- Extra FKs listed in section I
- `RevenueEvent.type` enum
- Soft-delete on `Organization`
- Replace heuristic “Al Noor” copy in AI fallback
- Deduplicate billing subscription fetch

---

## O. Exact recommended implementation order

Phase 1 stays “make what exists work.” Do not start new product features.

1. **Infra verify (no code):** Supabase Data API off; `DATABASE_URL` stays transaction pooler; cron scheduled; Clerk keys only on server/Vercel.
2. **Honesty in providers:** `EmailProvider.send` must send or return failure. WhatsApp already has a demo flag — surface that in Settings if missing.
3. **Tenant write hardening:** `organizationId` on updates/deletes (S1). Secret lookup (S2). Inbound signature (S3).
4. **Finish half-wired CRM:** property CRUD; lead field edit; team role change; follow-up complete error handling.
5. **Scale queries:** intelligence aggregates; import batching; inbox/follow-up pagination.
6. **Auth cleanup:** redirect Auth.js routes when Clerk is on.
7. **Schema cleanup (later, one small migration):** `CampaignRecipient` unique; drop or use `Agent`; optional FKs. Not now.
8. **Out of scope until Phase 1 is done:** Razorpay go-live, n8n, frontend redesign, Clerk replacement, new backend.

**Exact next implementation step after this audit:**  
Confirm Supabase Data API exposure in the dashboard, then implement **property CRUD + email send/fail-closed + `organizationId` on updates** as the first code PR. Do not enable RLS in that PR.

---

## Appendix: data-flow notes (not assumed from UI)

| Flow | Path | Backend? |
|---|---|---|
| Create lead | `LeadForm` → `createLeadAction` → `ingestLead` → qualify → follow-up sequence → automations | Yes |
| Edit lead fields | `updateLeadAction` only | Backend yes, **UI no** |
| Assign lead | `LeadActions` → `assignLeadAction` | Yes |
| Import | Import Center / CSV → `confirmImportAction` → `ingestLead` | Yes |
| Follow-up send | Engine / “Send now” → messaging provider | Yes (demo without creds) |
| Reactivation | `campaigns.ts` → WhatsApp/email | Yes (50 cap, demo send) |
| Inbox | Prisma list; reply on lead detail | Yes, incomplete UX |
| Properties | `db.property.findMany` | Read yes, **write no** |
| Chat widget | `/api/chat` → `handleChatTurn` → `searchProperties` | Yes |
| Revenue | Status WON → `RevenueEvent` | Yes |
| Team invite | `inviteMemberAction` | Yes |
| Team role | `updateMemberRoleAction` | Backend yes, **UI no** |
| Automations | Builder → engine on lead events | Yes |
| Settings | Org + integrations + API keys | Yes |
| Billing | Provider or local plan switch | Placeholder unless keys set — **do not implement now** |

---

## Files inspected (primary)

- `frontend/src/proxy.ts`, `frontend/src/auth.ts`, `frontend/src/lib/authz.ts`, `frontend/src/lib/auth/**`, `frontend/src/lib/safe-action.ts`, `frontend/src/lib/db.ts`, `frontend/src/lib/org.ts`, `frontend/src/lib/roles.ts`
- `frontend/src/app/(app)/**` (layout + all module pages)
- `frontend/src/actions/*.ts` (11 files)
- `frontend/src/app/api/**/route.ts` (11 routes)
- `frontend/src/lib/leads/service.ts`, `metrics.ts`, `intelligence/metrics.ts`, `follow-up/engine.ts`, `automations/engine.ts`, `properties/service.ts`, `messaging/*`, `billing/*`, `chat/engine.ts`
- `frontend/prisma/schema.prisma`, `frontend/prisma/postgres/schema.prisma`, `frontend/prisma/postgres/migrations/20260815170000_init/migration.sql`, `frontend/prisma/README.md`
- `frontend/.env.example`, `docs/PRODUCTION.md`
- `frontend/src/components/app-shell.tsx`, `providers.tsx`, `follow-up-actions.tsx`, auth/onboarding/import/billing components

Temporary diagnostics were not added. Nothing was reverted because no diagnostic code was introduced.
