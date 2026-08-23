import { PropertyInventory } from "@/components/property-inventory";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { listProperties } from "@/lib/properties/service";

export default async function PropertiesPage() {
  const user = await requireUser();
  const properties = await listProperties(user.organizationId);

  return (
    <div>
      <PageHeader
        title="Property inventory"
        description="Listings used by the website chatbot, lead intelligence and campaign personalization. Never invented."
      />
      <PropertyInventory properties={properties} />
    </div>
  );
}
