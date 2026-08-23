# Phase 1D implementation

**Date:** 2026-08-23  
**Scope:** Remaining backend correctness and production readiness from `docs/PHASE_1_BACKEND_AUDIT.md`. No Admin Panel, Razorpay, n8n, or RLS.

Phase 1B tenant writes and Phase 1C webhook HMAC / targeted secret lookup were left in place.

---

## 1. Follow-up assignee rules (S4)

**DONE**

Follow-ups inherit `assignedToId` from the lead’s agent. That id is now resolved with `resolveAssigneeInOrganization`: missing, cross-org, and non-member ids become `null` instead of being stored.

`completeFollowUpAction` and `sendFollowUpNowAction` require a manager (`OWNER` / `ADMIN` / `SALES_MANAGER`) or `assignedToId === user.id`. Unassigned follow-ups are manager-only. Completes still use org-scoped `updateMany`. The Complete button now surfaces errors and a success toast.

There is no membership `active` flag in the schema. “Inactive” means no current `Membership` row. No migration.

---

## 2. Chat fail-closed (S9)

**DONE**

`POST /api/chat` no longer returns a fabricated assistant reply on failure. The catch returns HTTP 500 `{ error: "Unable to process this chat right now." }` and does not persist a successful turn.

`handleChatTurn` still uses the existing LLM / heuristic provider abstraction. Inbox `sendLeadMessageAction` was already fail-closed (provider must confirm before the message row is written).

---

## 3. Intelligence query scale (P1)

**DONE**

`getIntelligenceMetrics` no longer `findMany`s every lead. Counts, sums, and chat aggregates run as parallel Prisma `count` / `aggregate` queries, all `organizationId`-scoped. Metric formulas match the previous in-memory filters (including counting a lead in both dormant and reactivated pools when both apply).

No cross-request cache.

---

## 4. Auth.js redirects when Clerk is enabled (A1)

**DONE**

`clerkAuthJsRedirect()` sends `/login`, `/signup`, `/forgot-password`, and `/reset-password` to the custom Clerk UI when Clerk keys are set. Auth.js pages and `SessionProvider` remain for the Clerk-off local fallback. Clerk trees still do not mount `SessionProvider`. The Clerk pages no longer link back to Auth.js routes, so there is no redirect loop. Signed-in Clerk users hitting `/sign-in` still go to `/dashboard`.

---

## 5. Lead field editing

**DONE**

Existing `updateLeadAction` is wired on the lead detail card via `LeadEditForm` (same input/select styling as the create form). Updates go through `updateLeadFields`: session org only, visibility-scoped find, Zod validation, org-scoped `updateMany`. Invalid input and cross-org ids fail.

---

## 6. Team role actions

**DONE**

`updateMemberRoleAction` is wired as a role `<select>` on the Team table for owners/admins. Logic lives in `changeMembershipRole`: admin/owner only, org-scoped membership, invalid roles rejected, only an owner can assign `OWNER`, last owner cannot be demoted. Managers who are not admins still see the label only.

---

## 7. Supabase Data API

**DONE** (document only)

Unchanged from Phase 1B: the app does not use the Data API. Prisma + `DATABASE_URL` only. RLS was not enabled.

---

## 8. Cron

**DONE** (document only)

| Job | Endpoint | Auth | Config |
|---|---|---|---|
| Follow-up worker | `GET /api/cron/follow-ups` | `Authorization: Bearer $CRON_SECRET` (`requireCronSecret`, fail-closed in production) | Not scheduled in `frontend/vercel.json` (empty). Hobby cannot run `*/10 * * * *`. |

Duplicate deliveries are mitigated by claiming follow-ups as `PROCESSING` in the engine. Production still needs an external scheduler to hit the route with `CRON_SECRET`. This PR does not add Vercel cron infrastructure.

---

## 9. Security regression

**DONE**

Left intact: server-resolved `organizationId`, tenant `updateMany`/`deleteMany`, property CRUD scope, email fail-closed, custom inbound HMAC, Meta raw-body signature, webhook idempotency, fingerprint secret lookup, secret redaction in logs/responses.

---

## Files changed

New:

- `frontend/src/lib/follow-up/access.ts`
- `frontend/src/lib/leads/fields.ts`
- `frontend/src/lib/team/roles.ts`
- `frontend/src/components/lead-edit-form.tsx`
- `frontend/src/components/team-role-select.tsx`
- `frontend/tests/phase1d.test.ts`
- `docs/PHASE_1D_IMPLEMENTATION.md`

Modified:

- `frontend/src/lib/org.ts`
- `frontend/src/actions/follow-ups.ts`
- `frontend/src/actions/leads.ts`
- `frontend/src/actions/team.ts`
- `frontend/src/lib/follow-up/engine.ts`
- `frontend/src/lib/automations/engine.ts`
- `frontend/src/lib/intelligence/metrics.ts`
- `frontend/src/app/api/chat/route.ts`
- `frontend/src/lib/auth/paths.ts`
- `frontend/src/app/login/page.tsx`
- `frontend/src/app/signup/page.tsx`
- `frontend/src/app/forgot-password/page.tsx`
- `frontend/src/app/reset-password/page.tsx`
- `frontend/src/app/sign-in/[[...sign-in]]/page.tsx`
- `frontend/src/app/sign-up/[[...sign-up]]/page.tsx`
- `frontend/src/app/(app)/leads/[id]/page.tsx`
- `frontend/src/app/(app)/team/page.tsx`
- `frontend/src/components/follow-up-actions.tsx`

---

## Migration status

**Not required.** Membership has no inactive flag; assignee checks use the existing `Membership` row. Intelligence, chat, auth, and UI changes need no schema change.

---

## Tests

`frontend/tests/phase1d.test.ts`

- Same-org / cross-org / non-member / empty assignee
- Follow-up complete authorization + cross-org delete isolation
- Intelligence metrics, empty org, isolation, no `lead.findMany`
- Lead field update, invalid input, unauthorized/empty org, cross-org
- Team role update, unauthorized, invalid role, privilege escalation, last-owner protection, cross-org
- Clerk/Auth.js redirect helper
- Chat invalid input, missing widget, provider/engine failure (no fake reply), successful turn

---

## Validation results

Run from `frontend/` on 2026-08-23:

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` | Pass — 10 files, **86/86** tests |
| `npm run build` | Pass — Next.js 16.3.1 production build |

---

## Remaining issues

**REMAINING**

- S5 import preview role alignment
- S8 billing cancel snapshot honesty
- Inbox thread pagination
- External production cron scheduler (ops)
- Confirm Data API off in the live Supabase dashboard (ops)
- Admin Panel, Razorpay go-live, n8n, RLS (explicitly out of scope)
