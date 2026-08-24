import { PageHeader } from "@/components/page-header";
import { TeamInviteForm } from "@/components/team-invite-form";
import { TeamMemberRemove } from "@/components/team-member-remove";
import { TeamRoleSelect } from "@/components/team-role-select";
import { requireRole } from "@/lib/authz";
import { ADMIN_ROLES, MANAGER_ROLES } from "@/lib/constants";
import { formatMoney } from "@/lib/format";
import { getTeamPerformance } from "@/lib/metrics";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function TeamPage() {
  const user = await requireRole(MANAGER_ROLES);
  const rows = await getTeamPerformance(user.organizationId);
  const isAdmin = ADMIN_ROLES.includes(user.role);

  return (
    <div>
      <PageHeader
        title="Team"
        description="Invite agents, assign work, and see who is recovering revenue."
      />
      <TeamInviteForm />
      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Leads handled</TableHead>
              <TableHead>Response time</TableHead>
              <TableHead>Follow-ups</TableHead>
              <TableHead>Qualified</TableHead>
              <TableHead>Won</TableHead>
              <TableHead>Revenue</TableHead>
              {isAdmin ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.membershipId}>
                <TableCell>
                  <p className="font-medium">{row.user.name}</p>
                  <p className="text-xs text-muted-foreground">{row.user.email}</p>
                </TableCell>
                <TableCell>
                  <TeamRoleSelect
                    membershipId={row.membershipId}
                    role={row.role}
                    canChangeRoles={ADMIN_ROLES.includes(user.role)}
                    actorRole={user.role}
                  />
                </TableCell>
                <TableCell>{row.handled}</TableCell>
                <TableCell>{row.responseTime}</TableCell>
                <TableCell>{row.followUps}</TableCell>
                <TableCell>{row.qualified}</TableCell>
                <TableCell>{row.won}</TableCell>
                <TableCell>{formatMoney(row.revenue)}</TableCell>
                {isAdmin ? (
                  <TableCell className="text-right">
                    <TeamMemberRemove
                      membershipId={row.membershipId}
                      name={row.user.name}
                      canRemove={row.user.id !== user.id && (row.role !== "OWNER" || user.role === "OWNER")}
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
