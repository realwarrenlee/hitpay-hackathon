import Link from "next/link";
import { DeliveryList } from "@/components/delivery-list";
import { getDb, loadSnapshot } from "@/server/ledger";
import { deliveryList } from "@/server/deliveries";
import { Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusFeedback } from "@/components/status-feedback";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deliveries" };
export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const snapshot = loadSnapshot(getDb());
  const rows = deliveryList(snapshot);
  return (
    <Shell>
      <PageHeader
        title="Deliveries"
        description="Review payment evidence, then decide how the next delivery can proceed."
        actions={
          <>
            <Link
              href="/invoice/new"
              className={buttonVariants({ variant: "outline" })}
            >
              New invoice
            </Link>
            <Link href="/deliveries/new" className={buttonVariants()}>
              New delivery
            </Link>
          </>
        }
      />
      <StatusFeedback status={query.status} />
      <Card>
        <CardHeader>
          <CardTitle>Upcoming deliveries</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length ? (
            <DeliveryList rows={rows} />
          ) : (
            <EmptyState
              title="No upcoming deliveries"
              description="Schedule a delivery for an existing customer."
              action={
                <Link href="/deliveries/new" className={buttonVariants()}>
                  New delivery
                </Link>
              }
            />
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
