import Link from "next/link";
import { AdminPager } from "@/components/admin-pager";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadAdminAuditLogs } from "@/lib/admin/access";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { formatDateTime } from "@/lib/format";

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    organizationId?: string;
    action?: string;
    actor?: string;
    entity?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const user = await requirePlatformAdmin();
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? "1", 10);
  const result = await loadAdminAuditLogs(user, {
    page: Number.isFinite(page) ? page : 1,
    organizationId: params.organizationId,
    action: params.action,
    actor: params.actor,
    entity: params.entity,
    from: params.from,
    to: params.to,
  });

  const queryFor = (nextPage: number) => {
    const query = new URLSearchParams();
    query.set("page", String(nextPage));
    if (result.organizationId) query.set("organizationId", result.organizationId);
    if (result.action) query.set("action", result.action);
    if (result.actor) query.set("actor", result.actor);
    if (result.entity) query.set("entity", result.entity);
    if (result.from) query.set("from", result.from);
    if (result.to) query.set("to", result.to);
    return `/admin/audit?${query.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Audit logs"
        description={`${result.total} recorded events. Sensitive metadata is redacted. IP and success/failure are not stored.`}
      />
      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Input name="organizationId" defaultValue={result.organizationId} placeholder="Agency ID" aria-label="Agency ID" />
        <Input name="action" defaultValue={result.action} placeholder="Action contains" aria-label="Action" />
        <Input name="actor" defaultValue={result.actor} placeholder="Actor name or email" aria-label="Actor" />
        <Input name="entity" defaultValue={result.entity} placeholder="Entity" aria-label="Entity" />
        <Input name="from" type="date" defaultValue={result.from} aria-label="From date" />
        <div className="flex gap-2">
          <Input name="to" type="date" defaultValue={result.to} aria-label="To date" />
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </div>
      </form>
      {result.items.length === 0 ? (
        <EmptyState title="No audit events" description="No AuditLog rows match this page or filter." />
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
                  <TableCell>
                    {row.action}
                    <p className="text-xs text-muted-foreground">
                      {row.entity}
                      {row.entityId ? ` · ${row.entityId}` : ""}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p>{row.actorName ?? "System"}</p>
                    <p className="text-xs text-muted-foreground">{row.actorEmail ?? ""}</p>
                  </TableCell>
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
