"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Organization, Role } from "@prisma/client";
import {
  sendWhatsAppTestAction,
  updateIntegrationAction,
  updateOrgSettingsAction,
  updateOrganizationAction,
} from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { MARKETS } from "@/lib/constants";
import type { OrgSettings } from "@/lib/constants";
import type { PublicIntegration } from "@/lib/integrations/public";
import { COUNTRIES, CURRENCIES } from "@/lib/markets";
import { toast } from "sonner";

export function SettingsForms({
  organization,
  settings,
  integrations,
  plan,
  role,
}: {
  organization: Organization;
  settings: OrgSettings;
  integrations: PublicIntegration[];
  plan: string;
  role: Role;
}) {
  const router = useRouter();
  const canAdmin = role === "OWNER" || role === "ADMIN";

  return (
    <Tabs defaultValue="organization">
      <TabsList>
        <TabsTrigger value="organization">Organization</TabsTrigger>
        <TabsTrigger value="ai">AI</TabsTrigger>
        <TabsTrigger value="followup">Follow-up</TabsTrigger>
        <TabsTrigger value="integrations">Integrations</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
      </TabsList>

      <TabsContent value="organization" className="mt-4">
        <form
          className="max-w-xl space-y-3 rounded-lg border border-border p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await updateOrganizationAction(new FormData(event.currentTarget));
            if (!result.ok) toast.error(result.error);
            else {
              toast.success("Organization updated");
              router.refresh();
            }
          }}
        >
          <Field label="Agency name" name="name" defaultValue={organization.name} />
          <div className="space-y-1.5">
            <Label htmlFor="country">Country</Label>
            <select
              id="country"
              name="country"
              defaultValue={organization.country}
              className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm"
            >
              {COUNTRIES.map((country) => (
                <option key={country}>{country}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="market">Market</Label>
            <select
              id="market"
              name="market"
              defaultValue={organization.market}
              className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm"
            >
              {MARKETS.map((market) => (
                <option key={market}>{market}</option>
              ))}
            </select>
          </div>
          <Field label="Timezone" name="timezone" defaultValue={organization.timezone} />
          <div className="space-y-1.5">
            <Label htmlFor="currency">Currency</Label>
            <select
              id="currency"
              name="currency"
              defaultValue={organization.currency}
              className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm"
            >
              {CURRENCIES.map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={!canAdmin}>
            Save
          </Button>
        </form>
      </TabsContent>

      <TabsContent value="ai" className="mt-4">
        <SettingsBundle settings={settings} canAdmin={canAdmin} />
      </TabsContent>
      <TabsContent value="followup" className="mt-4">
        <SettingsBundle settings={settings} canAdmin={canAdmin} />
      </TabsContent>
      <TabsContent value="notifications" className="mt-4">
        <SettingsBundle settings={settings} canAdmin={canAdmin} />
      </TabsContent>

      <TabsContent value="integrations" className="mt-4 space-y-4">
        {integrations.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} canAdmin={canAdmin} />
        ))}
      </TabsContent>

      <TabsContent value="billing" className="mt-4">
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm text-muted-foreground">Current plan</p>
          <p className="mt-1 text-2xl font-medium">{plan}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Paddle remains available as a fallback. Razorpay is used for live subscriptions when configured. Plan limits are enforced even before checkout.
          </p>
          <Button className="mt-4" asChild>
            <Link href="/billing">Open billing</Link>
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}

function IntegrationCard({
  integration,
  canAdmin,
}: {
  integration: PublicIntegration;
  canAdmin: boolean;
}) {
  const router = useRouter();
  const [testTo, setTestTo] = useState("");

  return (
    <form
      className="space-y-3 rounded-lg border border-border p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await updateIntegrationAction(new FormData(event.currentTarget));
        if (!result.ok) toast.error(result.error);
        else {
          toast.success(`${integration.name} saved`);
          router.refresh();
        }
      }}
    >
      <input type="hidden" name="id" value={integration.id} />
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">{integration.name}</p>
          <p className="text-xs text-muted-foreground">
            {integration.type} · ID {integration.id}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={integration.status === "CONNECTED" ? "default" : "secondary"}>
            {integration.status}
          </Badge>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={integration.enabled} />
            Enabled
          </label>
        </div>
      </div>
      {integration.type === "WHATSAPP" ? (
        <>
          <Field label="Phone number ID" name="phoneNumberId" defaultValue={integration.config.phoneNumberId} />
          <Field label="Business account ID" name="businessAccountId" defaultValue={integration.config.businessAccountId} />
          <Field
            label="Access token"
            name="accessToken"
            type="password"
            placeholder={integration.config.accessTokenSet ? integration.config.accessTokenHint : "Paste token"}
          />
          <Field label="From number" name="fromNumber" defaultValue={integration.config.fromNumber} />
          <Field
            label="Webhook secret"
            name="webhookSecret"
            type="password"
            placeholder={integration.config.webhookSecretSet ? integration.config.webhookSecretHint : "Shared verify token"}
          />
          <p className="text-xs text-muted-foreground">
            Saved credentials are never shown in full. Leave a field blank to keep the current value.
          </p>
        </>
      ) : null}
      {integration.type === "EMAIL" ? (
        <>
          <Field label="SMTP host" name="smtpHost" defaultValue={integration.config.smtpHost} />
          <Field label="SMTP user" name="smtpUser" defaultValue={integration.config.smtpUser} />
          <Field label="From email" name="fromEmail" defaultValue={integration.config.fromEmail} />
        </>
      ) : null}
      {integration.type === "WEBHOOK" || integration.type === "N8N" ? (
        <>
          <Field label="Endpoint URL" name="url" defaultValue={integration.config.url} />
          <Field
            label="Shared secret"
            name="secret"
            type="password"
            placeholder={integration.config.secretSet ? integration.config.secretHint : "Shared secret"}
          />
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!canAdmin}>
          Save credentials
        </Button>
        {integration.type === "WHATSAPP" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={testTo}
              onChange={(event) => setTestTo(event.target.value)}
              placeholder="+9715..."
              className="w-40"
            />
            <Button
              type="button"
              variant="outline"
              disabled={!canAdmin || !testTo}
              onClick={async () => {
                if (!window.confirm(`Send a live WhatsApp test to ${testTo}?`)) return;
                const form = new FormData();
                form.set("to", testTo);
                form.set("confirm", "yes");
                const result = await sendWhatsAppTestAction(form);
                if (!result.ok) toast.error(result.error);
                else toast.success(result.data?.demo ? "Demo send recorded (no live WhatsApp credentials)." : "Test message sent.");
              }}
            >
              Send test message
            </Button>
          </div>
        ) : null}
      </div>
    </form>
  );
}

function SettingsBundle({
  settings,
  canAdmin,
}: {
  settings: OrgSettings;
  canAdmin: boolean;
}) {
  const router = useRouter();
  return (
    <form
      className="grid max-w-2xl gap-3 rounded-lg border border-border p-4 md:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await updateOrgSettingsAction(new FormData(event.currentTarget));
        if (!result.ok) toast.error(result.error);
        else {
          toast.success("Settings saved");
          router.refresh();
        }
      }}
    >
      <Field label="Immediate response (minutes)" name="immediateResponseMinutes" type="number" defaultValue={String(settings.followUp.immediateResponseMinutes)} />
      <Field label="First follow-up (hours)" name="firstFollowUpHours" type="number" defaultValue={String(settings.followUp.firstFollowUpHours)} />
      <Field label="Second follow-up (hours)" name="secondFollowUpHours" type="number" defaultValue={String(settings.followUp.secondFollowUpHours)} />
      <Field label="Final follow-up (hours)" name="agentAlertHours" type="number" defaultValue={String(settings.followUp.agentAlertHours)} />
      <Field label="Dormant after (days)" name="dormantDays" type="number" defaultValue={String(settings.followUp.dormantDays)} />
      <Field label="Business hours start" name="businessHoursStart" type="number" defaultValue={String(settings.followUp.businessHoursStart)} />
      <Field label="Business hours end" name="businessHoursEnd" type="number" defaultValue={String(settings.followUp.businessHoursEnd)} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="respectBusinessHours" defaultChecked={settings.followUp.respectBusinessHours} />
        Respect agency business hours
      </label>
      <Field label="Immediate template" name="templateImmediate" defaultValue={settings.followUp.templates.immediate} />
      <Field label="+1 day template" name="templateDay1" defaultValue={settings.followUp.templates.day1} />
      <Field label="+3 day template" name="templateDay3" defaultValue={settings.followUp.templates.day3} />
      <Field label="+7 day template" name="templateDay7" defaultValue={settings.followUp.templates.day7} />
      <Field label="AI model" name="model" defaultValue={settings.ai.model} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="autoQualify" defaultChecked={settings.ai.autoQualify} />
        Auto-qualify new leads
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="suggestReplies" defaultChecked={settings.ai.suggestReplies} />
        Suggest replies
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="emailNotifications" defaultChecked={settings.notifications.email} />
        Email notifications
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="inAppNotifications" defaultChecked={settings.notifications.inApp} />
        In-app notifications
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="agentAlerts" defaultChecked={settings.notifications.agentAlerts} />
        Agent alerts
      </label>
      <div className="md:col-span-2">
        <Button type="submit" disabled={!canAdmin}>
          Save preferences
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} placeholder={placeholder} />
    </div>
  );
}
