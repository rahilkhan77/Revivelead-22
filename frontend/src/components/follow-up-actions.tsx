"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { completeFollowUpAction, runFollowUpEngineAction, sendFollowUpNowAction } from "@/actions/follow-ups";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function FollowUpActions({ id, status }: { id?: string; status?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!id) {
    return (
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await runFollowUpEngineAction();
            if (!result.ok) toast.error(result.error);
            else {
              toast.success(`Processed ${result.data?.processed ?? 0} follow-ups`);
              router.refresh();
            }
          })
        }
      >
        Run follow-up engine
      </Button>
    );
  }

  if (status !== "PENDING" && status !== "FAILED") return null;

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const form = new FormData();
            form.set("id", id);
            const result = await sendFollowUpNowAction(form);
            if (!result.ok) toast.error(result.error);
            else router.refresh();
          })
        }
      >
        Send now
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const form = new FormData();
            form.set("id", id);
            const result = await completeFollowUpAction(form);
            if (!result.ok) toast.error(result.error);
            else {
              toast.success("Follow-up completed");
              router.refresh();
            }
          })
        }
      >
        Complete
      </Button>
    </div>
  );
}
