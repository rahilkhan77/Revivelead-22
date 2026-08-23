import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { loadAdminAgencyDetail } from "@/lib/admin/access";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";

export default async function AdminAgencyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePlatformAdmin();
  const { id } = await params;
  const agency = await loadAdminAgencyDetail(user, id);

  if (!agency) {
    return (
      <div>
        <PageHeader title="Agency" description="This workspace was not found." />
        <EmptyState title="Agency not found" description="The requested organization does not exist or was removed." />
      </div>
    );
  }

  const usage = [
    { label: "Members", value: agency.usage.members },
    { label: "Leads", value: agency.usage.leads },
    { label: "Reactivated", value: agency.usage.reactivatedLeads },
    { label: "Properties", value: agency.usage.properties },
    { label: "Follow-ups", value: agency.usage.followUps },
    { label: "Campaigns", value: agency.usage.campaigns },
    { label: "Messages", value: agency.usage.messages },
    { label: "Chat sessions", value: agency.usage.chatSessions },
    { label: "Imports", value: agency.usage.imports },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={agency.name}
        description={`${agency.status} · created ${formatDate(agency.createdAt)}`}
        actions={
          <Link prefetch={false} href="/admin/agencies" className="text-sm underline-offset-4 hover:underline">
            Back to agencies
          </Link>
        }
      />

      <section>
        <h2 className="type-kicker text-muted-foreground mb-3">Identity</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Agency ID" value={agency.id} small />
          <MetricCard label="Slug" value={agency.slug} />
          <MetricCard label="Owner" value={agency.ownerName ?? "—"} hint={agency.ownerEmail ?? undefined} />
          <MetricCard label="Created" value={formatDate(agency.createdAt)} />
        </div>
      </section>

      <section>
        <h2 className="type-kicker text-muted-foreground mb-3">Usage</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {usage.map((card) => (
            <MetricCard key={card.label} label={card.label} value={card.value} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="type-kicker text-muted-foreground mb-3">Billing</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard label="Plan" value={agency.billing.plan ?? "—"} />
          <MetricCard label="Subscription" value={agency.billing.status ?? "None"} />
          <MetricCard label="Seats / lead limit" value={`${agency.billing.seats ?? "—"} / ${agency.billing.leadLimit ?? "—"}`} />
          <MetricCard label="Period end" value={formatDate(agency.billing.currentPeriodEnd)} />
          <MetricCard label="Provider" value={agency.billing.provider ?? "—"} />
        </div>
      </section>

      <section>
        <h2 className="type-kicker text-muted-foreground mb-3">Members</h2>
        {agency.members.length === 0 ? (
          <EmptyState title="No members" description="This agency has no memberships." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agency.members.map((member) => (
                  <TableRow key={member.membershipId}>
                    <TableCell>
                      <p className="font-medium">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.email}</p>
                    </TableCell>
                    <TableCell>{member.role}</TableCell>
                    <TableCell>{formatDate(member.joinedAt)}</TableCell>
                    <TableCell>{formatRelative(member.lastActivityAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <h2 className="type-kicker text-muted-foreground mb-3">Integrations</h2>
        {agency.integrations.length === 0 ? (
          <EmptyState title="No integrations" description="This agency has not configured any integrations." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Credentials</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agency.integrations.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.type}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{row.status}</TableCell>
                    <TableCell>{row.credentialsConfigured ? "Configured" : "Not configured"}</TableCell>
                    <TableCell>{formatDate(row.createdAt)}</TableCell>
                    <TableCell>{formatRelative(row.lastActivityAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <h2 className="type-kicker text-muted-foreground mb-3">Recent activity</h2>
        {agency.recentActivity.length === 0 ? (
          <EmptyState title="No recorded activity" description="No AuditLog rows exist for this agency yet." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agency.recentActivity.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                    <TableCell>
                      {row.action}
                      <p className="text-xs text-muted-foreground">{row.entity}</p>
                    </TableCell>
                    <TableCell>{row.actorName ?? "System"}</TableCell>
                    <TableCell className="max-w-xs truncate">{row.summary}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  small,
}: {
  label: string;
  value: string | number;
  hint?: string;
  small?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={small ? "break-all text-sm font-medium" : "text-2xl font-medium"}>{value}</p>
        {hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
