"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteLeadAction } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function LeadDeleteButton({ leadId, leadName }: { leadId: string; leadName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    setPending(true);
    try {
      const form = new FormData();
      form.set("leadId", leadId);
      const result = await deleteLeadAction(form);
      if (!result.ok) {
        toast.error(result.error ?? "Unable to delete lead.");
        setPending(false);
        return;
      }
      toast.success(`Deleted ${leadName}`);
      router.push("/leads");
      router.refresh();
    } catch {
      toast.error("Unable to delete lead.");
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
        Delete lead
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-sm">Delete {leadName}? This cannot be undone.</span>
      <Button variant="destructive" size="sm" disabled={pending} onClick={handleDelete}>
        {pending ? "Deleting…" : "Confirm delete"}
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}
