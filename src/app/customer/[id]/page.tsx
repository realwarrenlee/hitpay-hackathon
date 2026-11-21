import { formatDate, newestActivity } from "@/lib/presentation";
import { ActivityTable } from "@/components/activity-table";
import { MutationForm } from "@/components/mutation-form";
import { PageHeader } from "@/components/page-header";
import { StatusFeedback } from "@/components/status-feedback";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { Input } from "@/components/ui/input";
import { formatSgd } from "@/domain/money";
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
  approveHoldAction,
  checkCutoffAction,
  overrideHoldAction,
  rejectHoldAction,
} from "@/app/actions";
import { getDb, loadSnapshot } from "@/server/ledger";
import { customerModel } from "@/server/views";

export const dynamic = "force-dynamic";

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const snapshot = loadSnapshot(getDb());
  const model = customerModel(snapshot, id);
  if (!model) notFound();
  return (
    <Shell>
      <PageHeader
        title={model.name}
        description="Customer balance and delivery decisions"
        actions={
          <>
            <Link
              href={`/invoice/new?customerId=${id}`}
              className="text-sm underline"
            >
              New invoice
            </Link>
            <Link
              href={`/deliveries/new?customerId=${id}`}
              className="text-sm underline"
            >
              New delivery
            </Link>
          </>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            Delivery credit decision
            <Badge
              variant={model.hold === "Hold: normal" ? "secondary" : "outline"}
            >
              {model.hold === "Hold: normal"
                ? "No active hold"
                : model.hold === "Hold: proposed"
                  ? "Pay-first proposed"
                  : "Pay-first approved"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Overdue {model.overdue}. Threshold {model.threshold}.
            {model.deliveryId
              ? ` Delivery ${model.deliveryId} ${model.deliveryAmount}.`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <section aria-label="Cut-Off" className="space-y-4">
            {model.hold === "Hold: normal" ? (
              <p className="text-sm text-muted-foreground">
                Evaluating the next delivery can propose a pay-first hold;
                approval remains a separate decision.
              </p>
            ) : null}
            {model.unknownDueDates > 0 ? (
              <p role="status" className="text-sm">
                {model.unknownDueDates} unpaid invoice(s) have unknown due dates
                and are excluded from automatic overdue proposals.
              </p>
            ) : null}
            {model.unresolvedReference ? (
              <p role="alert" className="text-sm">
                Checkout creation unresolved: {model.unresolvedReference}. The
                approved hold remains. Inspect this reference with the provider
                before retrying; no automatic retry is safe.
              </p>
            ) : null}
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
              {model.hold === "Hold: proposed" ? (
                <>
                  <MutationForm
                    action={approveHoldAction}
                    confirmMessage="Approve this pay-first hold for the next delivery?"
                  >
                    <input type="hidden" name="customerId" value={model.id} />
                    <input
                      type="hidden"
                      name="deliveryId"
                      value={model.deliveryId ?? ""}
                    />
                    <Button type="submit" className="w-full sm:w-auto">
                      Approve hold
                    </Button>
                  </MutationForm>
                  <MutationForm
                    action={rejectHoldAction}
                    className="min-w-0 space-y-2 sm:w-72"
                  >
                    <label className="text-sm" htmlFor="reject-reason">
                      Reason for keeping credit
                    </label>
                    <Input
                      id="reject-reason"
                      name="reason"
                      required
                      maxLength={500}
                    />
                    <input type="hidden" name="customerId" value={model.id} />
                    <input
                      type="hidden"
                      name="deliveryId"
                      value={model.deliveryId ?? ""}
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      className="w-full sm:w-auto"
                    >
                      Reject hold
                    </Button>
                  </MutationForm>
                </>
              ) : null}
              {model.hold === "Hold: pay-first" ? (
                <MutationForm
                  action={overrideHoldAction}
                  className="min-w-0 space-y-2 sm:w-72"
                >
                  <label className="text-sm" htmlFor="override-reason">
                    Reason for override
                  </label>
                  <Input
                    id="override-reason"
                    name="reason"
                    required
                    maxLength={500}
                  />
                  <input type="hidden" name="customerId" value={model.id} />
                  <input
                    type="hidden"
                    name="deliveryId"
                    value={model.deliveryId ?? ""}
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    className="w-full sm:w-auto"
                  >
                    Override hold
                  </Button>
                </MutationForm>
              ) : null}
              <MutationForm action={checkCutoffAction}>
                <input type="hidden" name="customerId" value={model.id} />
                <input
                  type="hidden"
                  name="deliveryId"
                  value={model.deliveryId ?? ""}
                />
                <Button
                  type="submit"
                  variant="ghost"
                  className="w-full sm:w-auto"
                >
                  Evaluate next delivery
                </Button>
              </MutationForm>
            </div>
            {model.deliveryId ? (
              <p className="text-sm">
                <Link
                  href={`/deliveries/${model.deliveryId}`}
                  className="underline-offset-4 hover:underline"
                >
                  Review delivery and payment evidence
                </Link>
              </p>
            ) : null}
          </section>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[...snapshot.invoices.values()]
            .filter((invoice) => invoice.customerId === model.id)
            .map((invoice) => (
              <div
                key={invoice.id}
                className="flex flex-wrap justify-between gap-3 border-b pb-3 text-sm"
              >
                <Link href={`/invoice/${invoice.id}`} className="underline">
                  {invoice.id}
                </Link>
                <span>
                  Due {invoice.dueOn ? formatDate(invoice.dueOn) : "unknown"} ·{" "}
                  {formatSgd(invoice.remaining)} outstanding
                </span>
              </div>
            ))}
        </CardContent>
      </Card>
      <StatusFeedback status={query.status} />
      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityTable events={newestActivity(model.audit).slice(0, 12)} />
        </CardContent>
      </Card>
    </Shell>
  );
}
