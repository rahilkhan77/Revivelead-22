import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadAdminSecurity } from "@/lib/admin/access";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { formatDateTime } from "@/lib/format";

export default async function AdminSecurityPage() {
  const user = await requirePlatformAdmin();
  const security = await loadAdminSecurity(user);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Security"
        description="Persisted security-adjacent AuditLog rows only. Console-only events are listed as not captured."
      />

      <section>
        <h2 className="type-kicker text-muted-foreground mb-3">Not currently captured</h2>
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          {security.notCaptured.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="type-kicker text-muted-foreground mb-3">Recorded audit actions</h2>
        {security.recordedActions.length === 0 ? (
          <EmptyState title="No audit actions" description="The AuditLog table has no rows yet." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {security.recordedActions.map((row) => (
              <Card key={row.action}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground">{row.action}</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-medium">{row.count}</CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="type-kicker text-muted-foreground mb-3">
          Integration events ({security.persistedCount})
        </h2>
        {security.recent.length === 0 ? (
          <EmptyState
            title="No persisted security events"
            description="Integration updates are the only security-adjacent actions written to AuditLog today."
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
                {security.recent.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                    <TableCell>{row.action}</TableCell>
                    <TableCell>{row.actorName ?? "System"}</TableCell>
                    <TableCell>{row.organizationName}</TableCell>
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
