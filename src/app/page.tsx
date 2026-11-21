import Link from "next/link";
import {
  ArrowRightIcon,
  UploadIcon,
  ReceiptIcon,
  ListChecksIcon,
  ShieldAlertIcon,
  TimerIcon,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { StatTiles } from "@/components/stat-tiles";
import { ActivityTable } from "@/components/activity-table";
import { EmptyState } from "@/components/empty-state";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { overdueBalance } from "@/domain/balances";
import { formatSgd, sum } from "@/domain/money";
import { getDb, loadSnapshot } from "@/server/ledger";
import { pendingWork } from "@/server/work-queue";
import { formatDate, newestActivity, plural } from "@/lib/presentation";
import { customerBalances } from "@/server/dashboard";
export const dynamic = "force-dynamic";
export const metadata = { title: "Tally" };
export default function DeskPage() {
  const snapshot = loadSnapshot(getDb());
  const invoices = [...snapshot.invoices.values()];
  const open = invoices.filter((invoice) => invoice.status !== "paid");
  const work = pendingWork(snapshot);
  const pending = work.credits;
  const overdue = overdueBalance(
    invoices.map((invoice) => ({
      invoice,
      balance: {
        allocated: invoice.allocated,
        writtenOff: invoice.writtenOff,
        remaining: invoice.remaining,
        status: invoice.status,
      },
    })),
    snapshot.settings,
    snapshot.today,
  );
  const customers = customerBalances(snapshot).sort(
    (a, b) => b.overdue - a.overdue,
  );
  const upcoming = work.upcoming;
  const holds = customers.filter((customer) => customer.hold === "pay_first");
  const proposed = customers.filter((customer) => customer.hold === "proposed");
  const tasks = [
    ...(pending.length
      ? [
          {
            label: `${plural(pending.length, "credit")} to review`,
            detail: "Review incoming money that has not been fully allocated.",
            href: "/review",
            icon: ListChecksIcon,
          },
        ]
      : []),
    ...(work.proposals.length
      ? [
          {
            label: `${plural(work.proposals.length, "pay-first proposal")} awaiting approval`,
            detail:
              "Review invoice exposure and payment evidence before deciding.",
            href: `/deliveries/${work.proposals[0].delivery.id}`,
            icon: ShieldAlertIcon,
          },
        ]
      : []),
    ...(work.evaluations.length
      ? [
          {
            label: `${plural(work.evaluations.length, "delivery", "deliveries")} awaiting evaluation`,
            detail:
              "Check the next eligible delivery against the current policy.",
            href: `/deliveries/${work.evaluations[0].delivery.id}`,
            icon: TimerIcon,
          },
        ]
      : []),
    ...(work.awaitingPayment.length
      ? [
          {
            label: `${plural(work.awaitingPayment.length, "pay-first delivery", "pay-first deliveries")} awaiting payment`,
            detail: "Open the collection link or check payment verification.",
            href: `/deliveries/${work.awaitingPayment[0].delivery.id}`,
            icon: ReceiptIcon,
          },
        ]
      : []),
  ];
  return (
    <Shell>
      <PageHeader
        title="Overview"
        description="Your receivables and delivery decisions, in one place."
        actions={
          <Link href="/import" className={buttonVariants()}>
            <UploadIcon className="size-4" />
            Import bank statement
          </Link>
        }
      />
      <StatTiles
        tiles={[
          {
            label: "Total outstanding",
            value: formatSgd(sum(open.map((invoice) => invoice.remaining))),
            hint: plural(open.length, "unpaid invoice"),
            icon: ReceiptIcon,
          },
          {
            label: "Overdue balance",
            value: formatSgd(overdue),
            hint: "Past due after the configured grace period",
            icon: TimerIcon,
          },
          {
            label: "Credits to review",
            value: String(pending.length),
            hint: "Credits with unallocated money, excluding payouts",
            icon: ListChecksIcon,
          },
          {
            label: "Customers on hold",
            value: String(holds.length),
            hint: `${plural(proposed.length, "proposal")} awaiting approval`,
            icon: ShieldAlertIcon,
          },
        ]}
      />
      <div className="grid min-w-0 gap-6 xl:grid-cols-12">
        <Card className="xl:col-span-7">
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {tasks.length ? (
              tasks.map((task) => (
                <Link
                  key={task.label}
                  href={task.href}
                  className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <task.icon className="size-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{task.label}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {task.detail}
                    </p>
                  </div>
                  <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              ))
            ) : (
              <EmptyState
                title="No pending decisions"
                description="No unallocated credits or delivery decisions need attention. Outstanding invoice balances are still shown on this page."
              />
            )}
          </CardContent>
        </Card>
        <Card className="xl:col-span-5">
          <CardHeader>
            <CardTitle>Customer balances</CardTitle>
          </CardHeader>
          <CardContent>
            {customers.length ? (
              <div className="divide-y">
                {customers.slice(0, 5).map((customer) => (
                  <Link
                    key={customer.id}
                    href={`/customer/${customer.id}`}
                    className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="break-words font-medium hover:underline">
                        {customer.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {customer.hold === "pay_first"
                          ? "Pay-first hold"
                          : customer.hold === "proposed"
                            ? "Hold awaiting approval"
                            : "No active hold"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-medium tabular-nums">
                        {formatSgd(customer.overdue)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        overdue
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No customers yet"
                description="Your customer balances will appear here."
              />
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Upcoming deliveries</CardTitle>
        </CardHeader>
        <CardContent>
          {upcoming.length ? (
            <div className="divide-y">
              {upcoming.slice(0, 3).map((row) => (
                <Link
                  href={`/deliveries/${row.delivery.id}`}
                  key={row.delivery.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="font-medium">
                      {row.customer.name} · {row.delivery.id}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(row.delivery.scheduledFor)} ·{" "}
                      {formatSgd(row.delivery.amount)}
                    </p>
                  </div>
                  <div className="text-sm">
                    <p>{row.statusLabel}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.nextAction}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No upcoming deliveries"
              description="Schedule a delivery to review its credit decision."
              action={
                <Link href="/deliveries/new" className={buttonVariants()}>
                  New delivery
                </Link>
              }
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityTable events={newestActivity(snapshot.audit).slice(0, 5)} />
        </CardContent>
      </Card>
    </Shell>
  );
}
