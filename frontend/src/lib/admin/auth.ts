import { AuthError } from "@/lib/errors";
import type { AppUser } from "@/lib/auth/provision-clerk";
import { logSecurity } from "@/lib/log";

function parseAllowlist(value?: string | null) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function platformAdminEmails(env: NodeJS.ProcessEnv = process.env) {
  return parseAllowlist(env.REVIVELEAD_ADMIN_EMAILS).map((item) => item.toLowerCase());
}

export function platformAdminUserIds(env: NodeJS.ProcessEnv = process.env) {
  return parseAllowlist(env.REVIVELEAD_ADMIN_USER_IDS);
}

export function isPlatformAdmin(
  user: { id?: string | null; email?: string | null; role?: string | null } | null,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!user) return false;
  const email = user.email?.trim().toLowerCase();
  if (email && platformAdminEmails(env).includes(email)) return true;
  if (user.id && platformAdminUserIds(env).includes(user.id)) return true;
  return false;
}

export function assertPlatformAdmin(user: AppUser | null, env: NodeJS.ProcessEnv = process.env) {
  if (!user) throw new AuthError("You must be signed in.");
  if (!isPlatformAdmin(user, env)) {
    logSecurity("authz.denied", { reason: "platform_admin_required" });
    throw new AuthError("Admin access required.", 403);
  }
  return user;
}
