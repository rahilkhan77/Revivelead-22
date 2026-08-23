import type { AppUser } from "@/lib/auth/provision-clerk";
import { assertPlatformAdmin } from "@/lib/admin/auth";
import { listAdminAgencies } from "@/lib/admin/agencies";
import { listAdminAuditLogs } from "@/lib/admin/audit";
import { getAdminAgencyDetail } from "@/lib/admin/detail";
import { getAdminOverviewMetrics } from "@/lib/admin/metrics";
import { getAdminSecurityOverview } from "@/lib/admin/security";
import { listAdminBilling } from "@/lib/admin/billing";
import { listAdminUsers } from "@/lib/admin/users";

export async function loadAdminOverview(user: AppUser | null, env: NodeJS.ProcessEnv = process.env) {
  assertPlatformAdmin(user, env);
  return getAdminOverviewMetrics();
}

export async function loadAdminAgencies(
  user: AppUser | null,
  input: { page?: number; pageSize?: number } = {},
  env: NodeJS.ProcessEnv = process.env,
) {
  assertPlatformAdmin(user, env);
  return listAdminAgencies(input);
}

export async function loadAdminAgencyDetail(
  user: AppUser | null,
  organizationId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  assertPlatformAdmin(user, env);
  return getAdminAgencyDetail(organizationId);
}

export async function loadAdminUsers(
  user: AppUser | null,
  input: Parameters<typeof listAdminUsers>[0] = {},
  env: NodeJS.ProcessEnv = process.env,
) {
  assertPlatformAdmin(user, env);
  return listAdminUsers(input);
}

export async function loadAdminAuditLogs(
  user: AppUser | null,
  input: Parameters<typeof listAdminAuditLogs>[0] = {},
  env: NodeJS.ProcessEnv = process.env,
) {
  assertPlatformAdmin(user, env);
  return listAdminAuditLogs(input);
}

export async function loadAdminActivity(
  user: AppUser | null,
  input: Parameters<typeof listAdminAuditLogs>[0] = {},
  env: NodeJS.ProcessEnv = process.env,
) {
  assertPlatformAdmin(user, env);
  return listAdminAuditLogs(input);
}

export async function loadAdminSecurity(user: AppUser | null, env: NodeJS.ProcessEnv = process.env) {
  assertPlatformAdmin(user, env);
  return getAdminSecurityOverview();
}

export async function loadAdminBilling(
  user: AppUser | null,
  input: Parameters<typeof listAdminBilling>[0] = {},
  env: NodeJS.ProcessEnv = process.env,
) {
  assertPlatformAdmin(user, env);
  return listAdminBilling(input);
}
