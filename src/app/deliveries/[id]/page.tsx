import { formatDate, formatTime, plural } from "@/lib/presentation";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cents, formatSgd } from "@/domain/money";
import { readEnv } from "@/server/env";
import { getDb, loadSnapshot } from "@/server/ledger";
import { deliveryDetail } from "@/server/deliveries";
import { Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { StatusFeedback } from "@/components/status-feedback";
import { DeliveryActions } from "@/components/delivery-actions";
import { ActivityTable } from "@/components/activity-table";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Delivery decision" };
export default async function DeliveryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const env = readEnv();
  const snapshot = loadSnapshot(getDb());
  const model = deliveryDetail(snapshot, (await params).id);
  if (!model) notFound();
  const { delivery, customer, balances, request } = model;
  const duePosition = (invoice: (typeof model.invoices)[number]) =>
    invoice.remaining === 0
      ? "Settled"
      : invoice.daysPastDue === null
        ? "Unknown due date · excluded"
        : invoice.daysPastDue <= 0
          ? "Within terms"
          : invoice.daysPastDue <= (snapshot.settings.overdueDaysThreshold ?? 0)
            ? `${plural(invoice.daysPastDue, "day")} past due · within grace`
            : `${plural(invoice.daysPastDue, "day")} past due · overdue`;
  const proposal = model.proposal?.after as
    | {
        policyVersion?: number;
        policyDate?: string;
        settings?: {
          overdueBalanceThreshold: number;
          overdueDaysThreshold: number | null;
        };
      }
    | undefined;
  return (
    <Shell>
      <PageHeader
        title={`Delivery ${delivery.id}`}
        description={`${customer.name} · scheduled ${formatDate(delivery.scheduledFor)}`}
        actions={
          <Link
            href="/deliveries"
            className={buttonVariants({ variant: "outline" })}
          >
            All deliveries
          </Link>
        }
      />
      <StatusFeedback status={(await searchParams).status} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>For this delivery</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-3xl font-semibold tabular-nums">
              {formatSgd(delivery.amount)}
            </p>
            <StatusBadge
              tone={
                delivery.status === "pay_first"
                  ? "danger"
                  : delivery.status === "proposed_pay_first"
                    ? "warning"
                    : delivery.status === "released"
                      ? "success"
                      : "neutral"
              }
            >
              {model.statusLabel}
            </StatusBadge>
            <p className="text-sm text-muted-foreground">
              {model.paymentLabel}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Invoice balances</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-3xl font-semibold tabular-nums">
              {formatSgd(balances.outstanding)}
            </p>
            <p className="text-sm text-muted-foreground">
              Outstanding · {formatSgd(balances.overdue)} eligible overdue
            </p>
            <p className="text-sm text-muted-foreground">
              Paying for this delivery does not settle these invoices.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payment review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-3xl font-semibold tabular-nums">
              {model.credits.length}
            </p>
            <p className="text-sm text-muted-foreground">
              {model.credits.length
                ? `${formatSgd(model.reviewAmount)} unallocated · not applied to invoices.`
                : "No linked credits awaiting review."}
            </p>
            <Link
              href="/review"
              className="text-sm underline underline-offset-4"
            >
              Review bank payment evidence
            </Link>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Delivery decision</CardTitle>
          <CardDescription>{model.explanation}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium">Current policy · v{snapshot.policyVersion}</dt>
              <dd className="mt-1 text-muted-foreground">
                Overdue above {formatSgd(snapshot.settings.overdueBalanceThreshold)} · {plural(snapshot.settings.overdueDaysThreshold ?? 0, "grace day")} after due date
              </dd>
            </div>
            {proposal ? (
              <div>
                <dt className="font-medium">Recorded proposal · v{proposal.policyVersion ?? "unknown"}</dt>
                <dd className="mt-1 text-muted-foreground">
                  {proposal.policyDate ? formatDate(proposal.policyDate) : "Date not recorded"}
                  <br />
                  {proposal.settings
                    ? `Overdue above ${formatSgd(cents(proposal.settings.overdueBalanceThreshold))} · ${plural(proposal.settings.overdueDaysThreshold ?? 0, "grace day")} after due date`
                    : "Historical policy values not recorded"}
                </dd>
              </div>
            ) : null}
          </dl>
          {delivery.status === "proposed_pay_first" ? (
            <p className="text-xs text-muted-foreground">Policy changes do not re-evaluate an existing proposal. Human approval is required.</p>
          ) : null}
          {!model.canEvaluate &&
          model.nextDeliveryId &&
          model.nextDeliveryId !== delivery.id &&
          delivery.status === "on_credit" &&
          !delivery.creditDecisionBy ? (
            <p className="text-sm">
              The policy evaluates the earliest eligible delivery.{" "}
              <Link
                href={`/deliveries/${model.nextDeliveryId}`}
                className="underline"
              >
                Review {model.nextDeliveryId} first
              </Link>
              .
            </p>
          ) : null}
          {customer.hold.status !== "normal" && !model.heldHere ? (
            <p className="text-sm">
              This customer has a hold decision on{" "}
              <Link
                href={`/deliveries/${customer.hold.deliveryId}`}
                className="underline"
              >
                {customer.hold.deliveryId}
              </Link>
              . Review that delivery before making another decision.
            </p>
          ) : null}
          <DeliveryActions
            id={delivery.id}
            canEvaluate={model.canEvaluate}
            canApprove={
              model.heldHere && delivery.status === "proposed_pay_first"
            }
            canOverride={model.heldHere && delivery.status === "pay_first"}
            canCheck={request?.status === "pending"}
          />
          {request ? (
            <div className="space-y-3 rounded-lg border p-4">
              <h3 className="font-medium">
                {delivery.status === "pay_first"
                  ? "Pay for this delivery first"
                  : "Delivery payment request history"}
              </h3>
              <p className="text-sm">
                {formatSgd(request.amount)} · {request.referenceNumber}
              </p>
              <p className="text-sm text-muted-foreground">
                {model.paymentLabel}
              </p>
              {request.status === "creating" ? (
                <p role="alert" className="text-sm">
                  Checkout creation is unresolved. Inspect this reference with
                  the provider before retrying; the hold remains and automatic
                  recreation is blocked.
                </p>
              ) : null}
              {request.url &&
              request.status === "pending" &&
              delivery.status === "pay_first" ? (
                <Link href={request.url} className={buttonVariants()}>
                  Open {env.gateway === "fake" ? "simulated" : "sandbox"}{" "}
                  checkout
                </Link>
              ) : null}
            </div>
          ) : null}
          <Link
            href={`/driver/${delivery.id}`}
            className="text-sm underline underline-offset-4"
          >
            Open driver status
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Invoice evidence</CardTitle>
          <CardDescription>
            Balances include approved allocations.
            {model.invoices.some((invoice) => invoice.remaining > 0 && !invoice.dueOn)
              ? " Unknown due dates are excluded from overdue proposals."
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {model.invoices.length ? (
            <>
            <div className="hidden lg:block">
            <Table aria-label="Customer invoices">
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Issue date</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead>Due-date position</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell>
                      <Link
                        href={`/invoice/${invoice.id}`}
                        className="underline underline-offset-4"
                      >
                        {invoice.id}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(invoice.issuedOn)}</TableCell>
                    <TableCell>
                      {invoice.dueOn ? formatDate(invoice.dueOn) : "Unknown"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatSgd(invoice.remaining)}</TableCell>
                    <TableCell>{duePosition(invoice)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            <ul aria-label="Customer invoices" className="space-y-3 lg:hidden">
              {model.invoices.map((invoice) => (
                <li key={invoice.id} className="space-y-3 rounded-lg border p-4 text-sm">
                  <div className="flex justify-between gap-3">
                    <Link href={`/invoice/${invoice.id}`} className="font-medium underline underline-offset-4">{invoice.id}</Link>
                    <span className="shrink-0 text-right tabular-nums">{formatSgd(invoice.remaining)} remaining</span>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-xs">
                    <div><dt className="text-muted-foreground">Issue date</dt><dd className="mt-1">{formatDate(invoice.issuedOn)}</dd></div>
                    <div><dt className="text-muted-foreground">Due date</dt><dd className="mt-1">{invoice.dueOn ? formatDate(invoice.dueOn) : "Unknown"}</dd></div>
                  </dl>
                  <p className="text-xs text-muted-foreground">{duePosition(invoice)}</p>
                </li>
              ))}
            </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No invoices recorded for this customer.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <Link
              href={`/invoice/new?customerId=${customer.id}`}
              className="underline"
            >
              New invoice for this customer
            </Link>
            <Link href={`/customer/${customer.id}`} className="underline">
              Customer details
            </Link>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Bank evidence awaiting review</CardTitle>
          <CardDescription>
            Possible matches, not confirmed payments. Unlinked credits may also be relevant.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Last recorded bank import:{" "}
            {model.lastImport
              ? `${formatDate(model.lastImport)} · ${formatTime(model.lastImport)}`
              : "No bank import recorded"}
            .
          </p>
          {model.credits.length ? (
            model.credits.map((credit) => (
              <div key={credit.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {formatSgd(credit.amount)} · {formatDate(credit.valueDate)}
                </p>
                <p className="mt-1 break-words text-muted-foreground">
                  {credit.rawRef} · {credit.payerName}
                </p>
                <p className="mt-1 text-amber-700 dark:text-amber-400">
                  {formatSgd(credit.unallocated)} unallocated · human review
                  needed
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No linked credits awaiting review. This does not prove the customer has not paid.
            </p>
          )}
          <Link href="/review" className="text-sm underline">
            Open all payment evidence
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Delivery audit</CardTitle>
          <CardDescription>
            Creation, proposal, human decisions and payment outcomes for this
            delivery.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityTable events={[...model.audit].reverse()} />
        </CardContent>
      </Card>
    </Shell>
  );
}
