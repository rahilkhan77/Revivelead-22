"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateLeadAction } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LEAD_SOURCES, PROPERTY_TYPES } from "@/lib/constants";

type EditableLead = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  propertyType: string | null;
  location: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  intent: string;
  timeline: string | null;
  bedrooms: number | null;
  notes: string | null;
};

export function LeadEditForm({ lead }: { lead: EditableLead }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="grid gap-3 border-t border-border pt-3 md:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        const result = await updateLeadAction(new FormData(event.currentTarget));
        setPending(false);
        if (!result.ok) {
          setError(result.error ?? "Unable to update lead.");
          return;
        }
        setError(null);
        router.refresh();
      }}
    >
      <input type="hidden" name="id" value={lead.id} />
      <Field id={`${lead.id}-name`} label="Full name" name="name" defaultValue={lead.name} required />
      <Field id={`${lead.id}-phone`} label="Phone" name="phone" defaultValue={lead.phone ?? ""} />
      <Field id={`${lead.id}-email`} label="Email" name="email" type="email" defaultValue={lead.email ?? ""} />
      <SelectField id={`${lead.id}-source`} label="Source" name="source" options={[...LEAD_SOURCES]} defaultValue={lead.source ?? ""} />
      <SelectField
        id={`${lead.id}-type`}
        label="Property type"
        name="propertyType"
        options={[...PROPERTY_TYPES]}
        defaultValue={lead.propertyType ?? ""}
      />
      <Field id={`${lead.id}-location`} label="Location" name="location" defaultValue={lead.location ?? ""} />
      <Field id={`${lead.id}-budgetMin`} label="Budget min" name="budgetMin" type="number" defaultValue={lead.budgetMin ?? ""} />
      <Field id={`${lead.id}-budgetMax`} label="Budget max" name="budgetMax" type="number" defaultValue={lead.budgetMax ?? ""} />
      <SelectField
        id={`${lead.id}-intent`}
        label="Intent"
        name="intent"
        options={["UNKNOWN", "BUYING", "RENTING"]}
        defaultValue={lead.intent}
      />
      <Field id={`${lead.id}-timeline`} label="Timeline" name="timeline" defaultValue={lead.timeline ?? ""} />
      <Field id={`${lead.id}-bedrooms`} label="Bedrooms" name="bedrooms" type="number" defaultValue={lead.bedrooms ?? ""} />
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor={`${lead.id}-notes`}>Notes</Label>
        <Textarea id={`${lead.id}-notes`} name="notes" rows={3} defaultValue={lead.notes ?? ""} />
      </div>
      {error ? <p className="text-sm text-destructive md:col-span-2">{error}</p> : null}
      <div className="md:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save details"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  name,
  type = "text",
  required,
  defaultValue,
}: {
  id: string;
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type={type} required={required} defaultValue={defaultValue} />
    </div>
  );
}

function SelectField({
  id,
  label,
  name,
  options,
  defaultValue,
}: {
  id: string;
  label: string;
  name: string;
  options: string[];
  defaultValue?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
