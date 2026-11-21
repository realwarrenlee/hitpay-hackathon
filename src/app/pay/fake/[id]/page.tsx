import { localLedgerAccess } from "@/server/local-ledger-access";
import { TallyLogo } from "@/components/tally-logo";
import { simulatePayAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSgd } from "@/domain/money";
import { getDb, loadSnapshot } from "@/server/ledger";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payment" };

export default async function FakePayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const request = [...loadSnapshot(getDb()).paymentRequests.values()].find(
    (row) => row.hitpayRequestId === id,
  );
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center bg-background px-4 py-8">
      <div className="mb-6 flex items-center justify-center gap-3">
        <TallyLogo />
        <span className="font-semibold">Tally</span>
      </div>
      <Card>
        <CardHeader>
          <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
            Simulated checkout
          </p>
          <CardTitle className="text-3xl">PayNow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-lg">
            {request
              ? `${request.referenceNumber} · ${formatSgd(request.amount)}`
              : "Unknown checkout"}
          </p>
          <form action={simulatePayAction}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" disabled={!localLedgerAccess() || !request} className="h-12 w-full text-base">
              Confirm simulated payment
            </Button>
          </form>
          {query.status ? (
            <p role="status" className="text-sm">
              {query.status}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
