# Phase 2A — Admin panel foundation

**Date:** 2026-08-23  
**Scope:** Internal ReviveLead operations console. No Razorpay, n8n, RLS, or customer UI changes.

---

## 1. Admin authorization model

There is **no** internal-admin concept in Prisma or Clerk today.

| Identity | What it is | Admin access? |
|---|---|---|
| `Role.SALES_AGENT` | Agency member | No |
| `Role.SALES_MANAGER` | Agency manager | No |
| `Role.ADMIN` | Agency workspace admin | **No** |
| `Role.OWNER` | Agency owner | **No** |
| Allowlisted email or user id | ReviveLead operator | Yes |

Access is an environment allowlist, checked only on the server:

- `REVIVELEAD_ADMIN_EMAILS` — comma-separated, case-insensitive
- `REVIVELEAD_ADMIN_USER_IDS` — comma-separated Prisma `User.id` values (tests / break-glass)

`isPlatformAdmin` / `assertPlatformAdmin` / `requirePlatformAdmin` never trust `organizationId` or `role` from the client. Agency `ADMIN` is not a platform admin.

Signed-out users hitting `/admin` are sent to Clerk/Auth.js sign-in (edge + `requirePlatformAdmin`). Signed-in non-operators are redirected to `/dashboard`. Data loaders throw `AuthError` 403 so unauthorized callers get no metrics or agency rows.

No `User.platformAdmin` column was added (would be a future migration if the allowlist becomes unwieldy).

---

## 2. Admin routes

All live under `src/app/admin/` (outside the customer `(app)` shell). Layout calls `requirePlatformAdmin()`.

| Route | Phase 2A |
|---|---|
| `/admin` | Overview metrics |
| `/admin/agencies` | Paginated agency list |
| `/admin/users` | Placeholder |
| `/admin/activity` | Placeholder |
| `/admin/audit` | Placeholder |
| `/admin/security` | Placeholder |
| `/admin/billing` | Placeholder |

`/admin(.*)` is also on the Clerk/Auth.js protected matcher in `proxy.ts`. Nested placeholders inherit the layout gate. Nav links use `prefetch={false}`.

No admin link was added to the customer app shell.

---

## 3. Admin dashboard metrics

All values are Prisma `count` / `aggregate` over the whole platform (operator-only).

| Metric | Source |
|---|---|
| Total / active / inactive agencies | `Organization` + `Subscription.status` |
| Users / memberships / users created (7d) | `User`, `Membership` |
| Leads / leads created (7d) / reactivated | `Lead` |
| Follow-ups / messages / chat sessions | `FollowUp`, `LeadMessage`, `ChatSession` |
| Recovered revenue | `RevenueEvent` `reactivated_won` sum |
| Revenue at risk | `Lead.revenueAtRisk` sum |

**Omitted:** suspended agencies (no suspend flag), last-login / active sessions (no `lastSeenAt`). Inactive means subscription `PAST_DUE` or `CANCELED`. Active means `TRIALING`, `ACTIVE`, or no subscription row.

---

## 4. Agency list

`/admin/agencies` pages 20 rows (`pageSize` capped at 50). One `count` + one `findMany` with `_count` and owner membership, plus one `lead.groupBy` for last activity on that page. No per-agency query loop.

Columns: name, owner, members, leads, plan, status, created, last activity. Empty page shows `EmptyState`. No suspend/reactivate.

---

## 5. Query architecture

- Server Components only for admin pages
- `loadAdminOverview` / `loadAdminAgencies` assert platform admin, then run aggregates
- No public admin API routes
- No client database access

---

## 6. Security controls

1. Signed-out → sign-in  
2. Agency owner/member → `/dashboard` (pages) or 403 (loaders)  
3. Allowlisted operator → data  
4. Nested `/admin/*` uses the same layout  
5. Role/org in the request cannot elevate  
6. Customer UI unchanged  

---

## 7. Existing audit infrastructure

`AuditLog` already has: `id`, `organizationId`, `userId`, `action`, `entity`, `entityId`, `metadata`, `createdAt`. `writeAudit()` is used by product actions. Sufficient for a future Audit viewer. **No schema change.** The `/admin/audit` page is a placeholder only.

---

## 8. Files changed

New: `src/lib/admin/{auth,guard,metrics,agencies,access}.ts`, `src/components/admin-shell.tsx`, `src/components/admin-placeholder.tsx`, `src/app/admin/**`, `tests/phase2a.test.ts`, `docs/PHASE_2A_ADMIN_FOUNDATION.md`

Modified: `src/proxy.ts`, `.env.example`

---

## 9. Database migration

**Not required.**

---

## 10–13. Tests and validation

`tests/phase2a.test.ts`: unauthenticated denied, agency user/owner denied, allowlisted admin allowed, agency list + pagination + empty page, metrics from real rows, no data on 403.

Run from `frontend/` on 2026-08-23:

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` | Pass — 11 files, **90/90** tests |
| `npm run build` | Pass — `/admin` and nested admin routes compiled |

---

## Remaining Phase 2 work

- Agency detail `/admin/agencies/[id]`
- User directory
- Audit log viewer (schema already exists)
- Activity / security / billing consoles
- Suspend / reactivate (needs a schema field if required)
- Razorpay operations (out of scope)
- Optional later migration: `User.platformAdmin` if the allowlist should move into the database
