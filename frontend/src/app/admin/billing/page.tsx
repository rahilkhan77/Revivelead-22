import Link from "next/link";
import { AdminPager } from "@/components/admin-pager";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadAdminBilling } from "@/lib/admin/access";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { formatDate, formatDateTime } from "@/lib/format";

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; plan?: string; status?: string }>;
}) {
  const user = await requirePlatformAdmin();
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? "1", 10);
  const result = await loadAdminBilling(user, {
    page: Number.isFinite(page) ? page : 1,
    q: params.q,
    plan: params.plan,
    status: params.status,
  });

  const queryFor = (nextPage: number) => {
    const query = new URLSearchParams();
    query.set("page", String(nextPage));
    if (result.q) query.set("q", result.q);
    if (result.plan) query.set("plan", result.plan);
    if (result.status) query.set("status", result.status);
    return `/admin/billing?${query.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Billing"
        description={`${result.total} subscriptions. References are Razorpay/Paddle ids only — secrets are never stored here.`}
      />
      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-4">
        <Input name="q" defaultValue={result.q} placeholder="Agency name or ID" aria-label="Search agencies" />
        <select
          name="plan"
          defaultValue={result.plan}
          aria-label="Plan"
          className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
        >
          <option value="">All plans</option>
          <option value="STARTER">STARTER</option>
          <option value="PRO">PRO</option>
          <option value="ENTERPRISE">ENTERPRISE</option>
        </select>
        <select
          name="status"
          defaultValue={result.status}
          aria-label="Status"
          className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
        >
          <option value="">All statuses</option>
          <option value="TRIALING">TRIALING</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="PAST_DUE">PAST_DUE</option>
          <option value="CANCELED">CANCELED</option>
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      {result.items.length === 0 ? (
        <EmptyState title="No subscriptions" description="No billing rows match this page or filter." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agency</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Provider refs</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last event</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((row) => (
                <TableRow key={row.organizationId}>
                  <TableCell>
                    <Link prefetch={false} href={`/admin/agencies/${row.organizationId}`} className="font-medium underline-offset-4 hover:underline">
                      {row.organizationName}
                    </Link>
                  </TableCell>
                  <TableCell>{row.plan}</TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell>
                    <p>{row.billingPeriod ?? "month"}</p>
                    <p className="text-xs text-muted-foreground">
                      Ends {formatDate(row.currentPeriodEnd)}
                    </p>
                  </TableCell>
                  <TableCell className="text-xs">
                    <p>{row.provider ?? "unattached"}</p>
                    <p className="text-muted-foreground">{row.providerSubId ?? "—"}</p>
                  </TableCell>
                  <TableCell>{formatDate(row.createdAt)}</TableCell>
                  <TableCell>
                    <p>{row.lastBillingAction ?? "subscription.updated"}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(row.lastBillingEventAt)}</p>
                  </TableCell>
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
