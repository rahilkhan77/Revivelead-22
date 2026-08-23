# Phase 2B — Admin operations console

**Date:** 2026-08-23  
**Scope:** Agency detail, user directory, audit viewer, activity, and security visibility. No Razorpay, n8n, RLS, customer UI changes, or schema migration.

---

## 1. Agency detail

Route: `/admin/agencies/[id]`

`loadAdminAgencyDetail` asserts platform admin, then loads the organization by the **route id only**. It never accepts a client-supplied `organizationId` for scoping.

| Section | Source |
|---|---|
| Identity | `Organization` name, id, slug, created date, OWNER membership |
| Usage | `_count` / scoped `count` for members, leads, properties, follow-ups, campaigns, messages, chat sessions, imports, reactivated leads |
| Billing | Existing `Subscription` plan, status, seats, lead limit, period end, provider name |
| Members | Memberships for that organization only |
| Integrations | Type, name, status, created, last update, credentials configured (boolean) |
| Recent activity | Latest 8 `AuditLog` rows for that organization |

Unknown ids return `null` and render an empty state. Integration `config` is used only to decide whether a secret exists; the secret is never returned.

**Not shown:** `widgetKey`, `settings` JSON, `providerCustomerId`, `providerSubId`, API key hashes/prefixes, passwords.

---

## 2. User directory

Route: `/admin/users`

Rows are **memberships**, not raw `User` records, so each row has an agency and role.

| Column | Source |
|---|---|
| Identity / email | `User.name`, `User.email` |
| Agency | `Organization.name` |
| Role | `Membership.role` |
| Created | `User.createdAt` |
| Last activity | `User.updatedAt` (no last-login field exists) |

Server-side pagination (20, cap 50). Optional filters: search (`name` / `email` / agency name), agency id, role. `passwordHash` and `clerkId` are never selected.

No role modification in this phase.

---

## 3. Agency members

The agency detail page includes a members table from the same org-scoped query:

- member name / email
- role
- membership `createdAt`
- `User.updatedAt` as last activity

---

## 4. Audit viewer

Route: `/admin/audit`

Uses the existing `AuditLog` model. No duplicate logging system.

| Field | Present? |
|---|---|
| Timestamp | Yes — `createdAt` |
| Actor | Yes — `userId` + user name/email |
| Action / entity | Yes |
| Organization | Yes |
| Success / failure | **No column** |
| IP address | **Not stored** |
| Metadata | Yes — sanitized before render |

Filters (database-side): agency id, action contains, actor name/email/id, entity, from/to date. Newest-first. Paginated. Metadata is scrubbed; it is never rendered as raw JSON.

---

## 5. Activity view

Route: `/admin/activity`

Reuses `AuditLog`. Category chips map to existing action prefixes:

- Leads (`lead.` / `leads.`)
- Properties (`property.`)
- Campaigns (`campaign.`)
- Team (`team.`)
- Integrations (`integration.`)
- Organizations (`organization.`)

**Not shown as recorded activity:** sign-in/auth events, webhook HMAC failures, rate limits. Those are console `logSecurity` events only.

---

## 6. Security view

Route: `/admin/security`

Persisted surface: `integration.*` AuditLog rows plus a count of recorded audit actions.

Explicitly **not captured** (shown as such, not faked):

- Failed sign-in
- Webhook signature / unknown-integration failures
- Rate-limit events
- IP / device metadata
- Success/failure flags
- Platform-admin access denials

---

## 7. Authorization

Unchanged from Phase 2A.

Every Phase 2B loader calls `assertPlatformAdmin` via `src/lib/admin/access.ts`. Every page calls `requirePlatformAdmin`. The admin layout still gates `/admin/*`.

| Caller | Result |
|---|---|
| Signed out | Sign-in (pages) / 401 (loaders) |
| Signed-in customer / agency owner | `/dashboard` (pages) / 403 (loaders) |
| Allowlisted operator | Data |

Agency `OWNER` / `ADMIN` is still not a platform admin. Nav hiding is not used as a control.

---

## 8. Privacy / data minimization

`src/lib/admin/privacy.ts` redacts keys and values matching password, secret, token, authorization, API key, cookie, credential, webhook, hash, and payment-provider strings.

Admin pages never display:

- passwords / password hashes
- Clerk secrets
- integration secret values
- webhook signing secrets
- payment credentials
- session tokens
- authorization headers

IP addresses are not collected in this phase.

---

## 9. Query / performance

- Server Components only; no client database access
- Pagination + `skip`/`take` for users and audit
- Agency detail: one org query with `_count` and members/integrations, plus three scoped counts/recent logs
- Audit/activity: `count` + `findMany` for the requested page
- No N+1 loops
- Filters applied in Prisma `where`

---

## 10. Files changed

**New**

- `frontend/src/lib/admin/privacy.ts`
- `frontend/src/lib/admin/detail.ts`
- `frontend/src/lib/admin/users.ts`
- `frontend/src/lib/admin/audit.ts`
- `frontend/src/lib/admin/security.ts`
- `frontend/src/components/admin-pager.tsx`
- `frontend/src/app/admin/loading.tsx`
- `frontend/src/app/admin/agencies/[id]/page.tsx`
- `frontend/tests/phase2b.test.ts`
- `docs/PHASE_2B_ADMIN_OPERATIONS.md`

**Modified**

- `frontend/src/lib/admin/access.ts`
- `frontend/src/lib/admin/agencies.ts` (export `agencyStatus`)
- `frontend/src/app/admin/agencies/page.tsx` (link to detail)
- `frontend/src/app/admin/users/page.tsx`
- `frontend/src/app/admin/audit/page.tsx`
- `frontend/src/app/admin/activity/page.tsx`
- `frontend/src/app/admin/security/page.tsx`

`/admin/billing` remains a placeholder (Razorpay out of scope).

---

## 11. Migration status

**Not required.** Existing `Organization`, `Membership`, `User`, `Subscription`, `Integration`, and `AuditLog` models already support this phase.

---

## 12. Tests

`frontend/tests/phase2b.test.ts`:

- Signed-out denied (401)
- Agency member / other-agency owner denied (403)
- Platform admin allowed
- Agency detail scoped to the requested org; unknown id is `null`
- Integration secrets never appear in the payload
- User pagination and agency association; no password hashes
- Audit pagination, newest-first, action filter, redacted metadata
- Activity uses AuditLog prefixes; security does not invent events

---

## 13–15. Validation

Run from `frontend/` on 2026-08-23:

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` | Pass — 12 files, **96/96** tests |
| `npm run build` | Pass — `/admin/agencies/[id]`, `/admin/users`, `/admin/audit`, `/admin/activity`, `/admin/security` compiled as dynamic |

---

## 16. Remaining admin work

- Suspend / reactivate (needs a schema field if required)
- Persist auth / webhook / rate-limit events if operators need them in-app
- Last-login / session visibility (no `lastSeenAt` today)
- Audit success/failure and IP (not on `AuditLog`)
- Role changes from the admin console
- Billing / Razorpay operations (`/admin/billing`)
- Optional later migration: `User.platformAdmin` if the env allowlist should move into the database
