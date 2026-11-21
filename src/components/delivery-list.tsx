import Link from "next/link";
import { cn } from "cn";
import type { DeliveryDetail } from "@/server/deliveries";
import { formatSgd } from "@/domain/money";
import { formatDate } from "@/lib/presentation";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function Decision({ row }: { row: DeliveryDetail }) {
  const status = row.delivery.status;
  const label =
    status === "released"
      ? "Released"
      : status === "on_credit" && row.exception
        ? "Credit exception"
        : status === "on_credit"
          ? "On credit"
          : status === "pay_first"
            ? "Pay-first approved"
            : status === "proposed_pay_first"
              ? "Pay-first proposed"
              : "Cancelled";
  return (
    <StatusBadge
      tone={
        status === "pay_first"
          ? "danger"
          : status === "proposed_pay_first"
            ? "warning"
            : status === "released"
              ? "success"
              : "neutral"
      }
    >
      {label}
    </StatusBadge>
  );
}
function paymentLabel(row: DeliveryDetail) {
  if (!row.request) return "Not requested";
  if (row.request.status === "creating") return "Checkout unresolved";
  if (row.request.status === "completed") return "Verified";
  if (row.paymentLabel.includes("review")) return "Needs review";
  if (row.delivery.status === "on_credit" && row.exception)
    return "Earlier request pending";
  return "Awaiting payment";
}
function BankEvidence({ row }: { row: DeliveryDetail }) {
  return row.credits.length ? (
    <Link className="text-amber-700 underline dark:text-amber-400" href="/review">
      {row.credits.length} possible · review
    </Link>
  ) : (
    <span className="text-muted-foreground">None linked</span>
  );
}
function nextAction(row: DeliveryDetail) {
  if (row.request?.status === "creating") return "Inspect request";
  if (row.delivery.status === "pay_first") return "Check payment";
  if (row.exception && row.delivery.status === "on_credit") return "View exception";
  if (row.canEvaluate) return "Evaluate";
  return row.nextAction.replace("Review delivery details", "View details").replace("View audit", "View activity");
}
export function DeliveryList({ rows }: { rows: DeliveryDetail[] }) {
  return (
    <>
      <div className="hidden xl:block">
        <Table aria-label="Upcoming deliveries">
          <TableHeader>
            <TableRow>
              <TableHead>Delivery date</TableHead>
              <TableHead>Delivery / customer</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Invoice debt</TableHead>
              <TableHead>Bank evidence</TableHead>
              <TableHead>Delivery payment</TableHead>
              <TableHead>Delivery decision</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.delivery.id} className="[&_td]:align-top">
                <TableCell>{formatDate(row.delivery.scheduledFor)}</TableCell>
                <TableCell className="min-w-40 whitespace-normal">
                  <Link className="font-medium hover:underline" href={`/deliveries/${row.delivery.id}`}>
                    {row.customer.name}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">{row.delivery.id}</p>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatSgd(row.delivery.amount)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  <p>{formatSgd(row.balances.outstanding)}</p>
                  <p className="mt-1 text-muted-foreground">{formatSgd(row.balances.overdue)} overdue</p>
                </TableCell>
                <TableCell className="whitespace-normal text-xs"><BankEvidence row={row} /></TableCell>
                <TableCell className="whitespace-normal text-xs">{paymentLabel(row)}</TableCell>
                <TableCell className="whitespace-normal"><Decision row={row} /></TableCell>
                <TableCell className="whitespace-normal">
                  <Link href={`/deliveries/${row.delivery.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    {nextAction(row)}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul aria-label="Upcoming deliveries" className="grid gap-4 md:grid-cols-2 xl:hidden">
        {rows.map((row) => (
          <li key={row.delivery.id} className="min-w-0 space-y-4 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/deliveries/${row.delivery.id}`} className="break-words font-medium hover:underline">
                  {row.customer.name}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.delivery.id} · {formatDate(row.delivery.scheduledFor)}
                </p>
              </div>
              <p className="shrink-0 text-right font-semibold tabular-nums">{formatSgd(row.delivery.amount)}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="mb-1 text-xs text-muted-foreground">Delivery decision</dt>
                <dd><Decision row={row} /></dd>
              </div>
              <div>
                <dt className="mb-1 text-xs text-muted-foreground">Delivery payment</dt>
                <dd>{paymentLabel(row)}</dd>
              </div>
              <div className="col-span-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <dt className="text-xs text-muted-foreground">Bank evidence</dt>
                <dd><BankEvidence row={row} /></dd>
              </div>
              <div className="col-span-2 flex justify-between gap-3 border-t pt-3">
                <dt className="text-muted-foreground">Invoice debt</dt>
                <dd className="text-right tabular-nums">
                  {formatSgd(row.balances.outstanding)}
                  <p className="mt-1 text-xs text-muted-foreground">{formatSgd(row.balances.overdue)} overdue</p>
                </dd>
              </div>
            </dl>
            <Link href={`/deliveries/${row.delivery.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {nextAction(row)}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
