import { notFound } from "next/navigation";
import { ConversationPanel } from "@/components/conversation-panel";
import { PageHeader } from "@/components/page-header";
import { StatusBadge, TemperatureBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FollowUpTimeline } from "@/components/follow-up-timeline";
import { LeadActions } from "@/components/lead-actions";
import { LeadEditForm } from "@/components/lead-edit-form";
import { requireUser, canViewAllLeads } from "@/lib/authz";
import { formatBudget, formatDateTime, formatRelative } from "@/lib/format";
import { leadVisibilityWhere } from "@/lib/leads/service";
import { db } from "@/lib/db";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const [lead, agents] = await Promise.all([
    db.lead.findFirst({
      where: { id, ...leadVisibilityWhere(user.organizationId, user.id, canViewAllLeads(user.role)) },
      include: {
        assignedAgent: { select: { name: true } },
        messages: { orderBy: { createdAt: "asc" } },
        followUps: { orderBy: { dueAt: "asc" } },
      },
    }),
    db.membership.findMany({
      where: { organizationId: user.organizationId },
      select: { userId: true, role: true, user: { select: { name: true } } },
    }),
  ]);
  if (!lead) notFound();

  return (
    <div>
      <PageHeader
        title={lead.name}
        description={`${lead.propertyType ?? "Property"} · ${lead.location ?? "Location TBC"}`}
        actions={<LeadActions lead={lead} agents={agents} canAssign={canViewAllLeads(user.role)} />}
      />
      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
        <ConversationPanel leadId={lead.id} messages={lead.messages} />
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Lead intelligence</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Score" value={`${lead.leadScore} / 100`} />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Temperature</span>
                <TemperatureBadge value={lead.temperature} />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={lead.status} />
              </div>
              <Row label="Intent" value={lead.intent} />
              <Row label="Budget" value={formatBudget(lead.budgetMin, lead.budgetMax, lead.currency)} />
              <Row label="Timeline" value={lead.timeline ?? "—"} />
              <Row label="Agent" value={lead.assignedAgent?.name ?? "Unassigned"} />
              <Row label="Last contacted" value={formatRelative(lead.lastContactedAt)} />
              <Row label="Next follow-up" value={formatDateTime(lead.nextFollowUpAt)} />
              <Row label="Created" value={formatDateTime(lead.createdAt)} />
              <p className="pt-2 text-muted-foreground">Next action</p>
              <p>{lead.recommendedAction ?? "Qualify and make first contact."}</p>
              {lead.objections ? (
                <>
                  <p className="pt-2 text-muted-foreground">Objections</p>
                  <p>{lead.objections}</p>
                </>
              ) : null}
              {lead.notes ? (
                <>
                  <p className="pt-2 text-muted-foreground">Notes</p>
                  <p>{lead.notes}</p>
                </>
              ) : null}
              <LeadEditForm lead={lead} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Follow-ups</CardTitle>
            </CardHeader>
            <CardContent>
              <FollowUpTimeline followUps={lead.followUps} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
