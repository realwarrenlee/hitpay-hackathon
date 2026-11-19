import { StatusFeedback } from "@/components/status-feedback";
import { HintLoader } from "@/components/hint-loader";
import { InvoicePanels, ReviewQueue } from "@/components/review-queue";
import { Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { MutationForm } from "@/components/mutation-form";
import { Button } from "@/components/ui/button";
import { approvePreselectedAction, commitAction } from "@/app/actions";
import { readEnv } from "@/server/env";
import { explanationsPending } from "@/server/flow";
import { getDb, loadHintCache, loadSnapshot } from "@/server/ledger";
import { reviewModel } from "@/server/views";
export const dynamic = "force-dynamic";
export const metadata = { title: "Review" };
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const env = readEnv();
  const db = getDb();
  const snapshot = loadSnapshot(db);
  const hints = loadHintCache(db);
  const model = reviewModel(snapshot, hints);
  const waiting = explanationsPending(snapshot, hints);
  const suggested = model.cards.filter((card) => card.state === "Suggested");
  const approved = model.cards.filter((card) => card.state === "Approved");
  return (
    <Shell today={env.today} mode={env.gateway === "fake" ? "fake" : "sandbox"}>
      <PageHeader
        title="Review transactions"
        description="Check suggested invoice matches. Your approval moves the money."
        actions={
          <>
            <MutationForm
              action={approvePreselectedAction}
              confirmMessage="Approve all preselected matches? Review their allocation details before continuing."
            >
              <Button
                type="submit"
                variant="secondary"
                disabled={!suggested.some((card) => card.preselected)}
              >
                Approve all pre-ticked
              </Button>
            </MutationForm>
            <MutationForm
              action={commitAction}
              confirmMessage="Commit all approved allocations? This locks them as reconciled and removes the undo option."
            >
              <Button type="submit" disabled={!approved.length}>
                Commit approved
              </Button>
            </MutationForm>
          </>
        }
      />
      <StatusFeedback status={params.status} />
      <div className="flex flex-wrap gap-3">
        <StatusBadge tone={suggested.length ? "warning" : "neutral"}>
          {suggested.length} suggested
        </StatusBadge>
        <StatusBadge>{approved.length} approved</StatusBadge>
        <StatusBadge tone="success">
          {model.cards.filter((card) => card.state === "Reconciled").length}{" "}
          reconciled
        </StatusBadge>
        <StatusBadge>
          {model.cards.filter((card) => card.state === "Unmatched").length}{" "}
          unmatched
        </StatusBadge>
      </div>
      {waiting && <HintLoader />}
      <ReviewQueue cards={model.cards} />
      <InvoicePanels invoices={model.invoices} />
    </Shell>
  );
}
