"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { removeMemberAction } from "@/actions/team";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function TeamMemberRemove({
  membershipId,
  name,
  canRemove,
}: {
  membershipId: string;
  name: string;
  canRemove: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  if (!canRemove) return <span className="text-muted-foreground text-xs">—</span>;

  async function handleRemove() {
    setPending(true);
    try {
      const form = new FormData();
      form.set("membershipId", membershipId);
      const result = await removeMemberAction(form);
      if (!result.ok) {
        toast.error(result.error ?? "Unable to remove member.");
        setPending(false);
        return;
      }
      toast.success(`Removed ${name}`);
      setConfirming(false);
      router.refresh();
    } catch {
      toast.error("Unable to remove member.");
    } finally {
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Remove
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="destructive" size="sm" disabled={pending} onClick={handleRemove}>
        {pending ? "Removing…" : "Confirm"}
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}
