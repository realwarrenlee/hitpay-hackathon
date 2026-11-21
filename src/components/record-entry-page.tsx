import { addDays } from "@/domain/dates";
import { readEnv } from "@/server/env";
import { getDb, loadSnapshot } from "@/server/ledger";
import { Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { EntryForm } from "@/components/entry-form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export function RecordEntryPage({
  kind,
  customerId,
}: {
  kind: "invoice" | "delivery";
  customerId?: string;
}) {
  const env = readEnv();
  const customers = [...loadSnapshot(getDb()).customers.values()].map(
    ({ id, name }) => ({ id, name }),
  );
  return (
    <Shell>
      <PageHeader
        title={`New ${kind}`}
        description={`Record ${kind === "invoice" ? "an invoice" : "a delivery"} for an existing customer.`}
      />
      <Card>
        <CardHeader>
          <CardTitle>
            {kind === "invoice"
              ? "Invoice and agreed payment terms"
              : "Upcoming delivery"}
          </CardTitle>
          <CardDescription>
            Local supplier demonstration · entries and decisions are audited.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EntryForm
            kind={kind}
            customers={customers}
            today={env.today}
            tomorrow={addDays(env.today, 1)}
            customerId={
              customers.some((row) => row.id === customerId)
                ? customerId
                : undefined
            }
          />
        </CardContent>
      </Card>
    </Shell>
  );
}
