import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/agencies", label: "Agencies" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/activity", label: "Activity" },
  { href: "/admin/audit", label: "Audit Logs" },
  { href: "/admin/security", label: "Security" },
  { href: "/admin/billing", label: "Billing" },
];

export function AdminShell({
  pathname,
  operator,
  children,
}: {
  pathname: string;
  operator: { name?: string | null; email?: string | null };
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background min-h-svh lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="border-border bg-muted/20 border-b lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:block lg:px-4 lg:py-5">
          <BrandLogo href="/admin" className="h-5" />
          <p className="type-kicker text-muted-foreground hidden lg:mt-3 lg:block">Internal operations</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:px-3 lg:pb-6">
          {NAV.map((item) => {
            const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap",
                  active ? "bg-background text-foreground border-border border" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="border-border flex items-center justify-between border-b px-4 py-3 sm:px-6">
          <p className="type-kicker text-muted-foreground">ReviveLead admin</p>
          <p className="type-small text-muted-foreground truncate">
            {operator.name || operator.email || "Operator"}
          </p>
        </header>
        <main className="px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
