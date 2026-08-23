"use client";

import { useRouter } from "next/navigation";
import { updateMemberRoleAction } from "@/actions/team";
import { ROLE_LABELS } from "@/lib/constants";
import type { Role } from "@prisma/client";
import { toast } from "sonner";

const ROLE_OPTIONS: Role[] = ["OWNER", "ADMIN", "SALES_MANAGER", "SALES_AGENT"];

export function TeamRoleSelect({
  membershipId,
  role,
  canChangeRoles,
  actorRole,
}: {
  membershipId: string;
  role: Role;
  canChangeRoles: boolean;
  actorRole: Role;
}) {
  const router = useRouter();

  if (!canChangeRoles || (role === "OWNER" && actorRole !== "OWNER")) {
    return <>{ROLE_LABELS[role]}</>;
  }

  const options = actorRole === "OWNER" ? ROLE_OPTIONS : ROLE_OPTIONS.filter((item) => item !== "OWNER");

  return (
    <select
      defaultValue={role}
      className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
      onChange={async (event) => {
        const form = new FormData();
        form.set("membershipId", membershipId);
        form.set("role", event.target.value);
        const result = await updateMemberRoleAction(form);
        if (!result.ok) {
          toast.error(result.error);
          event.target.value = role;
          return;
        }
        toast.success("Role updated");
        router.refresh();
      }}
    >
      {options.map((item) => (
        <option key={item} value={item}>
          {ROLE_LABELS[item]}
        </option>
      ))}
    </select>
  );
}
