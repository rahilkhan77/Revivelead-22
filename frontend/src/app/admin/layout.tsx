import { headers } from "next/headers";
import { AdminShell } from "@/components/admin-shell";
import { requirePlatformAdmin } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();
  const pathname = (await headers()).get("x-revivelead-path") ?? "";

  return (
    <AdminShell pathname={pathname} operator={{ name: user.name, email: user.email }}>
      {children}
    </AdminShell>
  );
}
