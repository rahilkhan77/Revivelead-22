import Link from "next/link";
import { AdminPager } from "@/components/admin-pager";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadAdminUsers } from "@/lib/admin/access";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { formatDate, formatRelative } from "@/lib/format";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; organizationId?: string; role?: string }>;
}) {
  const user = await requirePlatformAdmin();
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? "1", 10);
  const result = await loadAdminUsers(user, {
    page: Number.isFinite(page) ? page : 1,
    q: params.q,
    organizationId: params.organizationId,
    role: params.role,
  });

  const queryFor = (nextPage: number) => {
    const query = new URLSearchParams();
    query.set("page", String(nextPage));
    if (result.q) query.set("q", result.q);
    if (result.organizationId) query.set("organizationId", result.organizationId);
    if (result.role) query.set("role", result.role);
    return `/admin/users?${query.toString()}`;
  };

  return (
    <div>
      <PageHeader title="Users" description={`${result.total} memberships across agencies. Roles cannot be changed from this console.`} />
      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-4">
        <Input name="q" defaultValue={result.q} placeholder="Search name, email, agency" aria-label="Search users" />
        <Input name="organizationId" defaultValue={result.organizationId} placeholder="Agency ID" aria-label="Agency ID" />
        <select
          name="role"
          defaultValue={result.role}
          aria-label="Role"
          className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
        >
          <option value="">All roles</option>
          <option value="OWNER">OWNER</option>
          <option value="ADMIN">ADMIN</option>
          <option value="SALES_MANAGER">SALES_MANAGER</option>
          <option value="SALES_AGENT">SALES_AGENT</option>
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      {result.items.length === 0 ? (
        <EmptyState title="No users" description="No memberships match this page or filter." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Agency</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((row) => (
                <TableRow key={row.membershipId}>
                  <TableCell>
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">{row.email}</p>
                  </TableCell>
                  <TableCell>
                    <Link prefetch={false} href={`/admin/agencies/${row.organizationId}`} className="underline-offset-4 hover:underline">
                      {row.organizationName}
                    </Link>
                  </TableCell>
                  <TableCell>{row.role}</TableCell>
                  <TableCell>{formatDate(row.createdAt)}</TableCell>
                  <TableCell>{formatRelative(row.lastActivityAt)}</TableCell>
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
