"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  cancelFollowUpAction,
  completeFollowUpAction,
  rescheduleFollowUpAction,
  runFollowUpEngineAction,
  sendFollowUpNowAction,
} from "@/actions/follow-ups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export function FollowUpActions({ id, status }: { id?: string; status?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showReschedule, setShowReschedule] = useState(false);
  const [due, setDue] = useState("");

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
    <div className="flex flex-wrap items-center gap-2">
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
            else {
              toast.success("Follow-up sent");
              router.refresh();
            }
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
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setShowReschedule((value) => !value)}>
        Reschedule
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const form = new FormData();
            form.set("id", id);
            const result = await cancelFollowUpAction(form);
            if (!result.ok) toast.error(result.error);
            else {
              toast.success("Follow-up cancelled");
              router.refresh();
            }
          })
        }
      >
        Cancel
      </Button>
      {showReschedule ? (
        <span className="flex items-center gap-1">
          <Input
            type="datetime-local"
            value={due}
            aria-label="New follow-up date and time"
            onChange={(event) => setDue(event.target.value)}
            className="h-7 w-auto text-xs"
          />
          <Button
            size="sm"
            disabled={pending || !due}
            onClick={() =>
              startTransition(async () => {
                const form = new FormData();
                form.set("id", id);
                form.set("dueAt", due);
                const result = await rescheduleFollowUpAction(form);
                if (!result.ok) toast.error(result.error);
                else {
                  toast.success("Follow-up rescheduled");
                  setShowReschedule(false);
                  setDue("");
                  router.refresh();
                }
              })
            }
          >
            Save
          </Button>
        </span>
      ) : null}
    </div>
  );
}
