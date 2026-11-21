import { Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { ActivityTable } from "@/components/activity-table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDb, loadSnapshot } from "@/server/ledger";
export const dynamic = "force-dynamic";
export const metadata = { title: "Activity" };
export default function AuditPage() {
  const audit = loadSnapshot(getDb()).audit;
  return (
    <Shell>
      <PageHeader
        title="Activity"
        description="Payment, invoice and delivery history."
      />
      <Card>
        <CardHeader>
          <CardTitle>System activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityTable events={audit} filterable />
        </CardContent>
      </Card>
    </Shell>
  );
}
