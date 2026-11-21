"use client";
import { useOptimistic, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/status-badge";
import { StatusFeedback } from "@/components/status-feedback";
import { MutationForm } from "@/components/mutation-form";
import {
  approveAction,
  approveSplitAction,
  commitAction,
  rejectAction,
  undoAction,
} from "@/app/actions";
import { formatSgd } from "@/domain/money";
import { displayReason, formatDate } from "@/lib/presentation";
import type { reviewModel } from "@/server/views";
export type ReviewCredit = ReturnType<typeof reviewModel>["cards"][number];

export function CreditBadge({ state }: { state: string }) {
  return (
    <StatusBadge
      tone={
        state === "Reconciled"
          ? "success"
          : state === "Suggested" || state === "Unmatched"
            ? "warning"
            : "neutral"
      }
    >
      {state}
    </StatusBadge>
  );
}

export function ReviewDetail({
  card,
  feedback,
}: {
  card: ReviewCredit;
  feedback?: string;
}) {
  const [pick, setPick] = useState("");
  const [pending, setPending] = useOptimistic(false);
  const [error, setError] = useState("");
  const chosen = card.options.find((option) => option.invoiceId === pick);
  const canApprove =
    card.state === "Suggested" &&
    (card.kind === "choose_one" ? chosen?.valid : card.valid);
  const approval = card.kind === "split" ? approveSplitAction : approveAction;
  const payer = card.reason.match(/(?:Payer|Alias) "([^"]+)" -> (.+?)(?: \(confirmed alias\))?\.(?: |$)/);
  const basis = displayReason(payer ? card.reason.replace(payer[0], "") : card.reason);
  const hint = card.referenceHint;
  const additionalHint = hint && (
    (hint.customer && hint.customer !== payer?.[2]) ||
    hint.invoices.some((id) => !card.options.some((option) => option.invoiceId === id))
  );
  return (
    <>
      <SheetHeader className="border-b px-6 py-5 pr-14">
        <SheetTitle>Review incoming credit</SheetTitle>
        <SheetDescription>
          {card.name} · {formatDate(card.valueDate)}
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Incoming credit</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              {card.amountLabel}
            </p>
          </div>
          <CreditBadge state={card.state} />
        </div>
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Transaction reference</dt>
            <dd className="mt-1 break-words font-medium">
              {card.rawRef || "No reference supplied"}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">Unallocated credit</dt>
            <dd className="shrink-0 text-right tabular-nums">{formatSgd(card.unallocated)}</dd>
          </div>
        </dl>
        <section className="space-y-3" aria-label="Matching evidence">
          <h3 className="font-semibold">Matching evidence</h3>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">{payer ? "Confirmed payer" : "Bank payer"}</dt>
              <dd className="mt-1 break-words">
                {payer ? `${payer[2]} · ${payer[1]} (confirmed alias)` : card.payerName || "Not identified"}
              </dd>
            </div>
            {basis ? (
              <div>
                <dt className="text-muted-foreground">Match basis</dt>
                <dd className="mt-1 break-words leading-5">{basis}</dd>
              </div>
            ) : null}
            {additionalHint ? (
              <div>
                <dt className="text-muted-foreground">AI reference hint · unverified</dt>
                <dd className="mt-1 break-words">{[hint.customer, ...hint.invoices].filter(Boolean).join(" · ")}</dd>
              </div>
            ) : null}
          </dl>
          {card.kind === "choose_one" && card.state === "Suggested" ? (
            <p className="text-sm font-medium">Choose an invoice; the match is not confirmed.</p>
          ) : null}
          {card.options.length ? (
            <fieldset className="space-y-3">
              <legend className="sr-only">Invoice choices</legend>
              {card.options.map((option) => (
                <div
                  key={option.invoiceId}
                  className="space-y-3 rounded-lg border p-4"
                >
                  <div className="flex items-start gap-3">
                    {card.kind === "choose_one" &&
                    card.state === "Suggested" ? (
                      <input
                        type="radio"
                        name="invoice-choice"
                        aria-label={`Choose ${option.invoiceId}`}
                        checked={pick === option.invoiceId}
                        disabled={!option.valid}
                        onChange={() => setPick(option.invoiceId)}
                        className="mt-1 size-4 accent-primary"
                      />
                    ) : null}
                    <div>
                      <Link
                        href={`/invoice/${option.invoiceId}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {option.invoiceId}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {option.customerName}
                      </p>
                    </div>
                  </div>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">
                        Balance now
                      </dt>
                      <dd className="shrink-0 text-right tabular-nums">
                        {option.currentRemaining === null
                          ? "Unavailable"
                          : formatSgd(option.currentRemaining)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">
                        {card.state === "Suggested"
                          ? "Proposed allocation"
                          : "Recorded allocation"}
                      </dt>
                      <dd className="shrink-0 text-right font-medium tabular-nums">
                        {formatSgd(option.amount)}
                      </dd>
                    </div>
                    {card.state === "Suggested" ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">
                          Remaining after approval
                        </dt>
                        <dd className="shrink-0 text-right tabular-nums">
                          {option.remainingAfter === null
                            ? "Exceeds current balance"
                            : formatSgd(option.remainingAfter)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              ))}
            </fieldset>
          ) : (
            <p className="text-sm text-muted-foreground">
              No active allocation suggestion. This credit remains unallocated
              and needs human review.
            </p>
          )}
        </section>
        {card.state === "Suggested" &&
        card.options.length > 0 &&
        !card.valid &&
        card.kind !== "choose_one" ? (
          <p
            role="alert"
            className="rounded-lg border border-amber-500/30 p-3 text-sm"
          >
            This suggestion no longer fits the available balances. It cannot be
            approved as shown. Refresh or reject it; no amount will be adjusted
            automatically.
          </p>
        ) : null}
        <StatusFeedback status={feedback} />
        <div className="space-y-3 border-t pt-5">
          <fieldset disabled={pending} className="flex flex-wrap gap-3">
            {card.suggestionId && card.state === "Suggested" ? (
              <>
                <MutationForm
                  action={approval}
                  confirmMessage={`Apply this credit to ${card.kind === "choose_one" ? pick || "the chosen invoice" : card.options.map((option) => option.invoiceId).join(" and ")}? Invoice balances update immediately; no bank transfer is made.`}
                >
                  <input
                    type="hidden"
                    name="suggestionId"
                    value={card.suggestionId}
                  />
                  {card.kind === "choose_one" ? (
                    <input type="hidden" name="pick" value={pick} />
                  ) : null}
                  <Button type="submit" disabled={!canApprove}>
                    Approve allocation{card.kind === "split" ? "s" : ""}
                  </Button>
                </MutationForm>
                <MutationForm action={rejectAction}>
                  <input
                    type="hidden"
                    name="suggestionId"
                    value={card.suggestionId}
                  />
                  <Button type="submit" variant="outline">
                    Reject suggestion
                  </Button>
                </MutationForm>
              </>
            ) : null}
            {card.approvedAllocationIds.length > 0 ? (
              <MutationForm
                action={async (data) => {
                  setPending(true);
                  setError("");
                  try {
                    await commitAction(data);
                  } catch {
                    setError("Unable to reconcile this credit. Reload to check its current state before trying again.");
                  } finally {
                    setPending(false);
                  }
                }}
                confirmMessage={`Reconcile ${formatSgd(card.approvedAmount)} for ${card.name}? This finalizes only this credit's approved allocations and removes Undo. Invoice balances will not change.`}
              >
                {card.approvedAllocationIds.map((id) => (
                  <input key={id} type="hidden" name="allocationId" value={id} />
                ))}
                <Button type="submit">{pending ? "Reconciling…" : "Reconcile"}</Button>
              </MutationForm>
            ) : null}
            {card.undoId && !card.committed ? (
              <MutationForm
                action={undoAction}
                confirmMessage="Undo this allocation approval? The invoice and unallocated credit balances will be restored."
              >
                <input type="hidden" name="allocationId" value={card.undoId} />
                <Button type="submit" variant="outline">
                  Undo allocation approval
                </Button>
              </MutationForm>
            ) : null}
          </fieldset>
          {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}
        </div>
      </div>
    </>
  );
}
