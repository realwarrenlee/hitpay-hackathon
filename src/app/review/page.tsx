import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { StatusFeedback } from "@/components/status-feedback";
import { HintLoader } from "@/components/hint-loader";
import { InvoicePanels, ReviewQueue } from "@/components/review-queue";
import { Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { localLedgerAccess } from "@/server/local-ledger-access";
import { explanationsPending } from "@/server/flow";
import { getDb, loadHintCache, loadSnapshot } from "@/server/ledger";
import { reviewModel } from "@/server/views";
export const dynamic = "force-dynamic";
export const metadata = { title: "Bank credits" };
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const db = getDb();
  const snapshot = loadSnapshot(db);
  const hints = loadHintCache(db);
  const model = reviewModel(snapshot, hints);
  const waiting = explanationsPending(snapshot, hints);
  return (
    <Shell>
      <PageHeader
        title="Bank credits"
        description="Match incoming credits to invoices. Approval updates balances; no bank funds are transferred."
        actions={<Link href="/import" className={buttonVariants()}>Import bank file</Link>}
      />
      <StatusFeedback status={params.status} />
      {waiting && localLedgerAccess() && <HintLoader />}
      <ReviewQueue cards={model.cards} feedback={params.status} />
      <InvoicePanels invoices={model.invoices} />
    </Shell>
  );
}
