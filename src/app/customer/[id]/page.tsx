import { ActivityTable } from "@/components/activity-table";
import { MutationForm } from "@/components/mutation-form";
import { PageHeader } from "@/components/page-header";
import { StatusFeedback } from "@/components/status-feedback";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  approveHoldAction,
  checkCutoffAction,
  overrideHoldAction,
  rejectHoldAction,
} from "@/app/actions";
import { readEnv } from "@/server/env";
import { getDb, loadSnapshot } from "@/server/ledger";
import { customerModel } from "@/server/views";

export const dynamic = "force-dynamic";

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const env = readEnv();
  const model = customerModel(loadSnapshot(getDb()), id);
  if (!model) notFound();
  return (
    <Shell today={env.today} mode={env.gateway === "fake" ? "fake" : "sandbox"}>
      <PageHeader
        title={model.name}
        description="Customer balance and delivery decisions"
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            Cut-Off
            <Badge
              variant={model.hold === "Hold: normal" ? "secondary" : "outline"}
            >
              {model.hold}
            </Badge>
          </CardTitle>
          <CardDescription>
            Overdue {model.overdue}. Threshold {model.threshold}.
            {model.deliveryId
              ? ` Delivery ${model.deliveryId} ${model.deliveryAmount}.`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <section aria-label="Cut-Off" className="space-y-4">
            <p role="status" className="text-lg font-medium">
              {model.hold}
            </p>
            <p className="text-sm text-muted-foreground">
              An overdue balance alone does not place a delivery on hold. Check
              Cut-Off to evaluate the next delivery; a proposed hold still needs
              your approval.
            </p>
            <div className="flex flex-wrap gap-2">
              <MutationForm
                action={approveHoldAction}
                confirmMessage="Approve this pay-first hold for the next delivery?"
              >
                <input type="hidden" name="customerId" value={model.id} />
                <Button
                  type="submit"
                  disabled={model.hold !== "Hold: proposed"}
                >
                  Approve hold
                </Button>
              </MutationForm>
              <MutationForm action={rejectHoldAction}>
                <input type="hidden" name="customerId" value={model.id} />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={model.hold !== "Hold: proposed"}
                >
                  Reject hold
                </Button>
              </MutationForm>
              <MutationForm action={overrideHoldAction}>
                <input type="hidden" name="customerId" value={model.id} />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={model.hold !== "Hold: pay-first"}
                >
                  Override hold
                </Button>
              </MutationForm>
              <MutationForm action={checkCutoffAction}>
                <input type="hidden" name="customerId" value={model.id} />
                <Button type="submit" variant="ghost">
                  Check Cut-Off
                </Button>
              </MutationForm>
            </div>
            {model.deliveryId ? (
              <p className="text-sm">
                <Link
                  href={`/driver/${model.deliveryId}`}
                  className="underline-offset-4 hover:underline"
                >
                  Open the driver view
                </Link>
              </p>
            ) : null}
          </section>
        </CardContent>
      </Card>
      <StatusFeedback status={query.status} />
      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityTable events={model.audit.slice(-12).reverse()} />
        </CardContent>
      </Card>
    </Shell>
  );
}
