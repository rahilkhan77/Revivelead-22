import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { loadAdminAgencies } from "@/lib/admin/access";
import { formatDate, formatRelative } from "@/lib/format";

export default async function AdminAgenciesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requirePlatformAdmin();
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? "1", 10);
  const result = await loadAdminAgencies(user, { page: Number.isFinite(page) ? page : 1 });

  return (
    <div>
      <PageHeader
        title="Agencies"
        description={`${result.total} workspaces. Open a row for usage, members, and billing already stored on the agency.`}
      />
      {result.items.length === 0 ? (
        <EmptyState title="No agencies" description="No organizations match this page." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agency</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link prefetch={false} href={`/admin/agencies/${row.id}`} className="font-medium underline-offset-4 hover:underline">
                      {row.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{row.slug}</p>
                  </TableCell>
                  <TableCell>
                    <p>{row.ownerName ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{row.ownerEmail ?? ""}</p>
                  </TableCell>
                  <TableCell>{row.memberCount}</TableCell>
                  <TableCell>{row.leadCount}</TableCell>
                  <TableCell>{row.plan ?? "—"}</TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell>{formatDate(row.createdAt)}</TableCell>
                  <TableCell>{formatRelative(row.lastActivityAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {result.pageCount > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Page {result.page} of {result.pageCount}
          </p>
          <div className="flex gap-3">
            {result.page > 1 ? (
              <Link prefetch={false} href={`/admin/agencies?page=${result.page - 1}`} className="underline-offset-4 hover:underline">
                Previous
              </Link>
            ) : null}
            {result.page < result.pageCount ? (
              <Link prefetch={false} href={`/admin/agencies?page=${result.page + 1}`} className="underline-offset-4 hover:underline">
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
