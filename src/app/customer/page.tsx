import Link from "next/link";
import { ReceiptIcon, UsersIcon, ShieldAlertIcon } from "lucide-react";
import { Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { StatTiles } from "@/components/stat-tiles";
import { CustomerTable } from "@/components/customer-table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { readEnv } from "@/server/env";
import { getDb, loadSnapshot } from "@/server/ledger";
import { customerBalances } from "@/server/dashboard";
import { formatSgd, sum } from "@/domain/money";
export const dynamic = "force-dynamic";
export const metadata = { title: "Customers" };
export default function CustomersPage() {
  const env = readEnv();
  const snapshot = loadSnapshot(getDb());
  const rows = customerBalances(snapshot);
  return (
    <Shell today={env.today} mode={env.gateway === "fake" ? "fake" : "sandbox"}>
      <PageHeader
        title="Customers"
        description="Keep track of balances and make informed delivery decisions."
      />
      <StatTiles
        tiles={[
          {
            label: "Total outstanding",
            value: formatSgd(sum(rows.map((row) => row.outstanding))),
            hint: "Unpaid balance across all customers",
            icon: ReceiptIcon,
          },
          {
            label: "Customers overdue",
            value: String(rows.filter((row) => row.overdue > 0).length),
            hint: `Of ${rows.length} customers`,
            icon: UsersIcon,
          },
          {
            label: "Customers on hold",
            value: String(
              rows.filter((row) => row.hold === "pay_first").length,
            ),
            hint: `${rows.filter((row) => row.hold === "proposed").length} proposed holds awaiting approval`,
            icon: ShieldAlertIcon,
          },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle>All customers</CardTitle>
          <CardDescription>
            Overdue balances do not automatically place a delivery on hold.{" "}
            <Link href="/settings" className="underline underline-offset-4">
              View delivery policy
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomerTable rows={rows} />
        </CardContent>
      </Card>
    </Shell>
  );
}
