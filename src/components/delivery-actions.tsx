"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deliveryAction } from "@/app/deliveries/actions";
import { useLedgerAccess } from "@/components/ledger-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DeliveryActions({
  id,
  canEvaluate,
  canApprove,
  canOverride,
  canCheck,
}: {
  id: string;
  canEvaluate: boolean;
  canApprove: boolean;
  canOverride: boolean;
  canCheck: boolean;
}) {
  const router = useRouter();
  const editable = useLedgerAccess();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  function act(
    intent: "evaluate" | "approve" | "reject" | "override" | "check_payment",
  ) {
    if (
      intent === "approve" &&
      !window.confirm(
        "Approve pay-first collection for this delivery amount? Older invoice debt remains separate.",
      )
    )
      return;
    start(async () => {
      try {
        setResult(await deliveryAction({ id, intent, reason }));
        router.refresh();
      } catch {
        setResult({
          ok: false,
          message:
            "Unable to reach the server. Reload and inspect the current delivery before retrying.",
        });
      }
    });
  }
  return (
    <div className="space-y-4">
      <fieldset
        disabled={!editable || pending}
        className="min-w-0 space-y-4"
        aria-busy={pending}
      >
        <div className="flex flex-wrap gap-3">
          {canEvaluate ? (
            <Button type="button" onClick={() => act("evaluate")}>
              Evaluate delivery
            </Button>
          ) : null}
          {canApprove ? (
            <Button type="button" onClick={() => act("approve")}>
              Approve pay-first
            </Button>
          ) : null}
          {canCheck ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => act("check_payment")}
            >
              Check payment status
            </Button>
          ) : null}
        </div>
        {canApprove || canOverride ? (
          <div className="space-y-3 rounded-lg border p-4">
            <label htmlFor="exception-reason" className="text-sm font-medium">
              Reason for a credit exception
            </label>
            <Input
              id="exception-reason"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explain why this delivery may proceed on credit"
            />
            <Button
              type="button"
              variant="outline"
              disabled={!reason.trim()}
              onClick={() => act(canOverride ? "override" : "reject")}
            >
              {canOverride
                ? "Override hold with reason"
                : "Reject proposal with reason"}
            </Button>
          </div>
        ) : null}
      </fieldset>
      {pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Processing delivery action…
        </p>
      ) : null}
      {result ? (
        <p
          role={result.ok ? "status" : "alert"}
          className={`text-sm ${result.ok ? "text-muted-foreground" : "text-red-700 dark:text-red-400"}`}
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
