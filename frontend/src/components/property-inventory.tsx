"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPropertyAction, deletePropertyAction, updatePropertyAction } from "@/actions/properties";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PROPERTY_TYPES } from "@/lib/constants";
import { formatMoney } from "@/lib/format";
import { PROPERTY_STATUSES } from "@/lib/properties/service";

type PropertyCard = {
  id: string;
  title: string;
  type: string;
  location: string;
  bedrooms: number | null;
  price: number | null;
  currency: string;
  status: string;
};

export function PropertyInventory({ properties }: { properties: PropertyCard[] }) {
  return (
    <div className="space-y-6">
      <PropertyForm />
      {properties.length === 0 ? (
        <EmptyState title="No properties yet" description="Add inventory so the chatbot can recommend real homes." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {properties.map((item) => (
            <PropertyCardForm key={item.id} property={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function PropertyForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        const result = await createPropertyAction(new FormData(event.currentTarget));
        setPending(false);
        if (!result.ok) {
          setError(result.error ?? "Unable to save property.");
          return;
        }
        setError(null);
        event.currentTarget.reset();
        router.refresh();
      }}
    >
      <Field id="new-title" label="Title" name="title" required />
      <SelectField id="new-type" label="Type" name="type" options={[...PROPERTY_TYPES]} />
      <Field id="new-location" label="Location" name="location" required />
      <Field id="new-city" label="City" name="city" />
      <Field id="new-price" label="Price" name="price" type="number" />
      <Field id="new-bedrooms" label="Bedrooms" name="bedrooms" type="number" />
      {error ? <p className="text-sm text-destructive md:col-span-2">{error}</p> : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add property"}
        </Button>
      </div>
    </form>
  );
}

function PropertyCardForm({ property }: { property: PropertyCard }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-3 rounded-lg border border-border p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        const result = await updatePropertyAction(new FormData(event.currentTarget));
        setPending(false);
        if (!result.ok) {
          setError(result.error ?? "Unable to update property.");
          return;
        }
        setError(null);
        router.refresh();
      }}
    >
      <input type="hidden" name="id" value={property.id} />
      <Field id={`${property.id}-title`} label="Title" name="title" defaultValue={property.title} required />
      <SelectField id={`${property.id}-type`} label="Type" name="type" options={[...PROPERTY_TYPES]} defaultValue={property.type} />
      <Field id={`${property.id}-location`} label="Location" name="location" defaultValue={property.location} required />
      <Field id={`${property.id}-price`} label="Price" name="price" type="number" defaultValue={property.price ?? ""} />
      <Field id={`${property.id}-bedrooms`} label="Bedrooms" name="bedrooms" type="number" defaultValue={property.bedrooms ?? ""} />
      <SelectField id={`${property.id}-status`} label="Status" name="status" options={[...PROPERTY_STATUSES]} defaultValue={property.status} />
      <p className="text-xs text-muted-foreground">
        {property.location} · {property.bedrooms ?? "—"} bed · {formatMoney(property.price, property.currency)}
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={async () => {
            const form = new FormData();
            form.set("id", property.id);
            setPending(true);
            const result = await deletePropertyAction(form);
            setPending(false);
            if (!result.ok) {
              setError(result.error ?? "Unable to delete property.");
              return;
            }
            router.refresh();
          }}
        >
          Delete
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
  id?: string;
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
}) {
  const fieldId = id ?? name;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <Input id={fieldId} name={name} type={type} required={required} defaultValue={defaultValue} />
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
  id?: string;
  label: string;
  name: string;
  options: string[];
  defaultValue?: string;
}) {
  const fieldId = id ?? name;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <select
        id={fieldId}
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
