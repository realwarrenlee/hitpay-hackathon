import { CopyReminder } from "@/components/copy-reminder";
import { MutationForm } from "@/components/mutation-form";
import { PageHeader } from "@/components/page-header";
import { StatusFeedback } from "@/components/status-feedback";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
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
import { readEnv } from "@/server/env";
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
  const env = readEnv();
  const snapshot = loadSnapshot(getDb());
  const invoice = reviewModel(snapshot).invoices.find((row) => row.id === id);
  const stored = snapshot.invoices.get(id as never);
  if (!invoice || !stored) notFound();
  const customer = snapshot.customers.get(stored.customerId);
  return (
    <Shell today={env.today} mode={env.gateway === "fake" ? "fake" : "sandbox"}>
      <PageHeader
        title={invoice.name}
        description={customer?.name ?? stored.customerId}
      />
      <Card className="w-full max-w-4xl">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>{invoice.status}</span>
            <Badge
              variant={invoice.status === "Paid" ? "secondary" : "outline"}
            >
              {invoice.status}
            </Badge>
          </CardTitle>
          <CardDescription>
            {invoice.remainingLabel}. Issued {stored.issuedOn}. Total is the
            open balance plus what has already been allocated.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p role="status" className="text-sm">
            {invoice.status}
          </p>
          <p className="text-sm text-muted-foreground">
            {invoice.remainingLabel}
          </p>
          {invoice.status !== "Paid" ? (
            <MutationForm action={requestRemainderAction}>
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <Button type="submit">{invoice.requestLabel}</Button>
            </MutationForm>
          ) : null}
          <StatusFeedback status={query.status} />
          {invoice.requestUrl ? (
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
