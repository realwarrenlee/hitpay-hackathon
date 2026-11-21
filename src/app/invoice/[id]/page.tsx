import { formatDate } from "@/lib/presentation";
import { CopyReminder } from "@/components/copy-reminder";
import { MutationForm } from "@/components/mutation-form";
import { PageHeader } from "@/components/page-header";
import { StatusFeedback } from "@/components/status-feedback";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  checkPaymentStatusAction,
  requestRemainderAction,
} from "@/app/actions";
import { getDb, loadSnapshot } from "@/server/ledger";
import { reviewModel } from "@/server/views";

export const dynamic = "force-dynamic";

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const snapshot = loadSnapshot(getDb());
  const invoice = reviewModel(snapshot).invoices.find((row) => row.id === id);
  const stored = snapshot.invoices.get(id as never);
  if (!invoice || !stored) notFound();
  const customer = snapshot.customers.get(stored.customerId);
  return (
    <Shell>
      <PageHeader
        title={invoice.name}
        description={customer?.name ?? stored.customerId}
      />
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            Invoice balance
            <StatusBadge tone={invoice.status === "Paid" ? "success" : "neutral"}>
              {invoice.status}
            </StatusBadge>
          </CardTitle>
          <CardDescription>
            Issued {formatDate(stored.issuedOn)}. Due{" "}
            {stored.dueOn
              ? formatDate(stored.dueOn)
              : "date unknown — excluded from automatic overdue proposals"}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-3xl font-semibold tracking-tight tabular-nums">
            {invoice.remainingLabel}
          </p>
          {invoice.unresolvedReference ? (
            <p role="alert" className="text-sm">
              Checkout creation unresolved: {invoice.unresolvedReference}.
              Inspect this reference with the provider before retrying. No
              automatic retry is safe.
            </p>
          ) : null}
          {invoice.remaining > 0 && !invoice.unresolvedReference ? (
            <MutationForm action={requestRemainderAction}>
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <Button type="submit">{invoice.requestLabel}</Button>
            </MutationForm>
          ) : null}
          <StatusFeedback status={query.status} />
          {invoice.remaining > 0 && invoice.requestUrl ? (
            <CopyReminder url={invoice.requestUrl} />
          ) : null}
          {invoice.pendingRequestId ? (
            <MutationForm action={checkPaymentStatusAction}>
              <input
                type="hidden"
                name="paymentRequestId"
                value={invoice.pendingRequestId}
              />
              <input
                type="hidden"
                name="returnTo"
                value={`/invoice/${invoice.id}`}
              />
              <Button type="submit" variant="secondary">
                Check payment status
              </Button>
            </MutationForm>
          ) : null}
          <p className="text-sm">
            <Link href="/review" className="underline-offset-4 hover:underline">
              Back to the review queue
            </Link>
          </p>
        </CardContent>
      </Card>
    </Shell>
  );
}
