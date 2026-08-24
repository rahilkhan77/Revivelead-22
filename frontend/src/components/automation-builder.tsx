"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteAutomationAction, toggleAutomationAction, upsertAutomationAction } from "@/actions/automations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Automation, AutomationExecution } from "@prisma/client";
import { toast } from "sonner";

const triggers = ["LEAD_CREATED", "LEAD_INACTIVE", "FOLLOW_UP_DUE", "LEAD_BECOMES_HOT", "NO_RESPONSE"];
const actions = [
  "SEND_WHATSAPP",
  "SEND_EMAIL",
  "CREATE_TASK",
  "NOTIFY_AGENT",
  "CHANGE_LEAD_STATUS",
  "ASSIGN_AGENT",
];

type FormState = {
  id: string | null;
  name: string;
  trigger: string;
  action: string;
  message: string;
  enabled: boolean;
  status: string;
  agentId: string;
};

const EMPTY: FormState = {
  id: null,
  name: "",
  trigger: triggers[0],
  action: actions[0],
  message: "",
  enabled: true,
  status: "",
  agentId: "",
};

function parseConfig(config: string): { message: string; status: string; agentId: string } {
  try {
    const parsed = JSON.parse(config || "{}");
    return {
      message: typeof parsed.message === "string" ? parsed.message : "",
      status: typeof parsed.status === "string" ? parsed.status : "",
      agentId: typeof parsed.agentId === "string" ? parsed.agentId : "",
    };
  } catch {
    return { message: "", status: "", agentId: "" };
  }
}

export function AutomationBuilder({
  automations,
}: {
  automations: (Automation & { executions: AutomationExecution[] })[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const editing = form.id !== null;

  function startEdit(automation: Automation) {
    const config = parseConfig(automation.config);
    setForm({
      id: automation.id,
      name: automation.name,
      trigger: automation.trigger,
      action: automation.action,
      message: config.message,
      enabled: automation.enabled,
      status: config.status,
      agentId: config.agentId,
    });
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      toast.error("Give the automation a name.");
      return;
    }
    setSaving(true);
    try {
      const data = new FormData();
      if (form.id) data.set("id", form.id);
      data.set("name", form.name.trim());
      data.set("trigger", form.trigger);
      data.set("action", form.action);
      data.set("message", form.message);
      data.set("enabled", form.enabled ? "true" : "false");
      if (form.status) data.set("status", form.status);
      if (form.agentId) data.set("agentId", form.agentId);
      const result = await upsertAutomationAction(data);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Automation updated" : "Automation saved");
      setForm(EMPTY);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-2">
        <Input
          placeholder="Automation name"
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
        />
        <select
          className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
          value={form.trigger}
          onChange={(event) => setForm((current) => ({ ...current, trigger: event.target.value }))}
        >
          {triggers.map((item) => (
            <option key={item} value={item}>
              {item.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <select
          className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
          value={form.action}
          onChange={(event) => setForm((current) => ({ ...current, action: event.target.value }))}
        >
          {actions.map((item) => (
            <option key={item} value={item}>
              {item.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <Input
          placeholder="Optional message / note"
          value={form.message}
          onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
        />
        <div className="flex items-center gap-2 md:col-span-2">
          <Button type="button" disabled={saving} onClick={handleSubmit} className="w-fit">
            {saving ? "Saving…" : editing ? "Save changes" : "Add automation"}
          </Button>
          {editing ? (
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setForm(EMPTY)}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        {automations.map((automation) => (
          <div key={automation.id} className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{automation.name}</p>
                <p className="text-sm text-muted-foreground">
                  When {automation.trigger.replaceAll("_", " ").toLowerCase()} →{" "}
                  {automation.action.replaceAll("_", " ").toLowerCase()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={automation.enabled}
                  onCheckedChange={async () => {
                    const data = new FormData();
                    data.set("id", automation.id);
                    const result = await toggleAutomationAction(data);
                    if (!result.ok) toast.error(result.error);
                    else router.refresh();
                  }}
                />
                <Button size="sm" variant="ghost" onClick={() => startEdit(automation)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const data = new FormData();
                    data.set("id", automation.id);
                    const result = await deleteAutomationAction(data);
                    if (!result.ok) toast.error(result.error);
                    else {
                      toast.success("Automation deleted");
                      if (form.id === automation.id) setForm(EMPTY);
                      router.refresh();
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
            {automation.executions[0] ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Last run {automation.executions[0].status} · {automation.executions.length} recent executions
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No executions yet</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
