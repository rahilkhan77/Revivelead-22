import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requirePlatformAdmin } from "@/lib/admin/guard";
import { loadAdminOverview } from "@/lib/admin/access";
import { formatMoney } from "@/lib/format";

export default async function AdminOverviewPage() {
  const user = await requirePlatformAdmin();
  const metrics = await loadAdminOverview(user);

  const groups = [
    {
      title: "Agencies",
      cards: [
        { label: "Total agencies", value: metrics.totalAgencies },
        { label: "Active / trial", value: metrics.activeAgencies },
        { label: "Past due / canceled", value: metrics.inactiveAgencies },
      ],
    },
    {
      title: "Users",
      cards: [
        { label: "Total users", value: metrics.totalUsers },
        { label: "Memberships", value: metrics.totalMembers },
        { label: "Users created (7d)", value: metrics.recentUsers },
      ],
    },
    {
      title: "Leads",
      cards: [
        { label: "Total leads", value: metrics.totalLeads },
        { label: "Leads created (7d)", value: metrics.recentLeads },
        { label: "Reactivated leads", value: metrics.reactivatedLeads },
      ],
    },
    {
      title: "Product activity",
      cards: [
        { label: "Follow-ups", value: metrics.followUps },
        { label: "Messages", value: metrics.messages },
        { label: "Chat sessions", value: metrics.chatSessions },
      ],
    },
    {
      title: "Revenue",
      cards: [
        { label: "Recovered revenue", value: formatMoney(metrics.recoveredRevenue) },
        { label: "Revenue at risk", value: formatMoney(metrics.revenueAtRisk) },
      ],
    },
  ];

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Live platform totals from PostgreSQL. Agency OWNER/ADMIN roles cannot see this console."
      />
      <div className="space-y-8">
        {groups.map((group) => (
          <section key={group.title}>
            <h2 className="type-kicker text-muted-foreground mb-3">{group.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.cards.map((card) => (
                <Card key={card.label}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground">{card.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-2xl font-medium">{card.value}</CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
