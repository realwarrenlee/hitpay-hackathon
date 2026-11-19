import { Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { ActivityTable } from "@/components/activity-table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { readEnv } from "@/server/env";
import { getDb, loadSnapshot } from "@/server/ledger";
export const dynamic = "force-dynamic";
export const metadata = { title: "Audit trail" };
export default function AuditPage() {
  const env = readEnv();
  const audit = loadSnapshot(getDb()).audit;
  return (
    <Shell today={env.today} mode={env.gateway === "fake" ? "fake" : "sandbox"}>
      <PageHeader
        title="Audit trail"
        description="A permanent record of changes. Newest activity appears first."
      />
      <Card>
        <CardHeader>
          <CardTitle>System activity</CardTitle>
          <CardDescription>
            {audit.length} recorded events · read-only
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityTable events={[...audit].reverse()} />
        </CardContent>
      </Card>
    </Shell>
  );
}
