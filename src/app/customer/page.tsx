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
} from "@/components/ui/card";
import { getDb, loadSnapshot } from "@/server/ledger";
import { customerBalances } from "@/server/dashboard";
import { buttonVariants } from "@/components/ui/button";
import { plural } from "@/lib/presentation";
import { formatSgd, sum } from "@/domain/money";
export const dynamic = "force-dynamic";
export const metadata = { title: "Customers" };
export default function CustomersPage() {
  const snapshot = loadSnapshot(getDb());
  const rows = customerBalances(snapshot);
  return (
    <Shell>
      <PageHeader
        title="Customers"
        description="Keep track of balances and make informed delivery decisions."
        actions={
          <Link href="/invoice/new" className={buttonVariants()}>
            New invoice
          </Link>
        }
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
            hint: `Of ${plural(rows.length, "customer")}`,
            icon: UsersIcon,
          },
          {
            label: "Customers on hold",
            value: String(
              rows.filter((row) => row.hold === "pay_first").length,
            ),
            hint: `${plural(rows.filter((row) => row.hold === "proposed").length, "proposed hold")} awaiting approval`,
            icon: ShieldAlertIcon,
          },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle>All customers</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerTable rows={rows} />
        </CardContent>
      </Card>
    </Shell>
  );
}
