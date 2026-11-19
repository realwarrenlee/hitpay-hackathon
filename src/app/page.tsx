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
import { StatusBadge } from "@/components/status-badge";
import { ActivityTable } from "@/components/activity-table";
import { EmptyState } from "@/components/empty-state";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
  CardDescription,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { creditState, overdueBalance } from "@/domain/balances";
import { formatSgd, sum } from "@/domain/money";
import { readEnv } from "@/server/env";
import { getDb, loadSnapshot } from "@/server/ledger";
import { customerBalances } from "@/server/dashboard";
export const dynamic = "force-dynamic";
export const metadata = { title: "Tally" };
export default function DeskPage() {
  const env = readEnv();
  const snapshot = loadSnapshot(getDb());
  const invoices = [...snapshot.invoices.values()];
  const open = invoices.filter((invoice) => invoice.status !== "paid");
  const pending = [...snapshot.credits.values()].filter(
    (credit) =>
      !credit.reviewFlags.includes("hitpay_payout") &&
      ["unmatched", "suggested"].includes(
        creditState(
          [...snapshot.allocations.values()].filter(
            (row) => row.creditId === credit.id,
          ),
        ),
      ),
  );
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
  const holds = customers.filter((customer) => customer.hold === "pay_first");
  const proposed = customers.filter((customer) => customer.hold === "proposed");
  return (
    <Shell today={env.today} mode={env.gateway === "fake" ? "fake" : "sandbox"}>
      <PageHeader
        title="Overview"
        description="Your receivables and delivery decisions, in one place."
        actions={
          <Link href="/import" className={buttonVariants()}>
            <UploadIcon className="size-4" />
            Import bank file
          </Link>
        }
      />
      <StatTiles
        tiles={[
          {
            label: "Total outstanding",
            value: formatSgd(sum(open.map((invoice) => invoice.remaining))),
            hint: `${open.length} open invoices`,
            icon: ReceiptIcon,
          },
          {
            label: "Overdue balance",
            value: formatSgd(overdue),
            hint: "Based on your current delivery policy",
            icon: TimerIcon,
          },
          {
            label: "Pending review",
            value: String(pending.length),
            hint: "Incoming credits needing your attention",
            icon: ListChecksIcon,
          },
          {
            label: "Customers on hold",
            value: String(holds.length),
            hint: `${proposed.length} proposed holds awaiting approval`,
            icon: ShieldAlertIcon,
          },
        ]}
      />
      <div className="grid min-w-0 gap-6 xl:grid-cols-12">
        <Card className="xl:col-span-7">
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>
              Take the next step to keep your books moving.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link
              href={pending.length ? "/review" : "/import"}
              className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <ListChecksIcon className="size-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {pending.length
                    ? `${pending.length} credits to review`
                    : "Bring in your bank transactions"}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {pending.length
                    ? "Review suggested matches before approving allocations."
                    : "Upload a DBS CSV to find and match incoming credits."}
                </p>
              </div>
              <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
            </Link>
            <Link
              href="/customer"
              className="flex items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <ShieldAlertIcon className="size-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {proposed.length
                    ? `${proposed.length} delivery holds to approve`
                    : "Review customer delivery decisions"}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {proposed.length
                    ? "A proposed hold needs your approval before pay-first applies."
                    : `${holds.length} approved pay-first holds. Overdue balances alone do not stop deliveries.`}
                </p>
              </div>
              <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
        <Card className="xl:col-span-5">
          <CardHeader>
            <CardTitle>Customer balances</CardTitle>
            <CardDescription>Highest overdue balances first</CardDescription>
            <CardAction>
              <Link
                href="/customer"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                View all ↗
              </Link>
            </CardAction>
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
                            : "On credit"}
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
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            Latest recorded changes to your books
          </CardDescription>
          <CardAction>
            <StatusBadge>Recorded</StatusBadge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ActivityTable events={snapshot.audit.slice(-5).reverse()} />
        </CardContent>
      </Card>
    </Shell>
  );
}
