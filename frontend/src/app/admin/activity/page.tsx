import Link from "next/link";
import { AdminPager } from "@/components/admin-pager";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadAdminActivity } from "@/lib/admin/access";
import { ADMIN_ACTIVITY_CATEGORIES } from "@/lib/admin/audit";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { formatDateTime } from "@/lib/format";

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string; organizationId?: string }>;
}) {
  const user = await requirePlatformAdmin();
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? "1", 10);
  const result = await loadAdminActivity(user, {
    page: Number.isFinite(page) ? page : 1,
    category: params.category,
    organizationId: params.organizationId,
  });

  const queryFor = (nextPage: number) => {
    const query = new URLSearchParams();
    query.set("page", String(nextPage));
    if (result.category && result.category !== "all") query.set("category", result.category);
    if (result.organizationId) query.set("organizationId", result.organizationId);
    return `/admin/activity?${query.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Activity"
        description="Operational events from the existing AuditLog. Sign-in, webhook, and rate-limit events are not persisted."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {ADMIN_ACTIVITY_CATEGORIES.map((category) => {
          const active = (result.category || "all") === category.id;
          const href =
            category.id === "all" ? "/admin/activity" : `/admin/activity?category=${category.id}`;
          return (
            <Link
              key={category.id}
              prefetch={false}
              href={href}
              className={`rounded-md border px-2.5 py-1 text-sm ${
                active ? "border-foreground bg-muted" : "border-border hover:bg-muted/50"
              }`}
            >
              {category.label}
            </Link>
          );
        })}
      </div>
      {result.items.length === 0 ? (
        <EmptyState
          title="No recorded activity"
          description="This category has no AuditLog rows. Login and security console events are not captured here."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Agency</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(row.createdAt)}</TableCell>
                  <TableCell>{row.action}</TableCell>
                  <TableCell>{row.actorName ?? "System"}</TableCell>
                  <TableCell>
                    <Link prefetch={false} href={`/admin/agencies/${row.organizationId}`} className="underline-offset-4 hover:underline">
                      {row.organizationName}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{row.summary}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <AdminPager page={result.page} pageCount={result.pageCount} hrefFor={queryFor} />
    </div>
  );
}
