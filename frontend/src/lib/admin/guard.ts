import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/authz";
import { isPlatformAdmin } from "@/lib/admin/auth";
import { signInPath } from "@/lib/auth/paths";
import { logSecurity } from "@/lib/log";

export async function requirePlatformAdmin() {
  const user = await getSessionUser();
  if (!user) redirect(signInPath());
  if (!isPlatformAdmin(user)) {
    logSecurity("authz.denied", { reason: "platform_admin_required" });
    redirect("/dashboard");
  }
  return user;
}
