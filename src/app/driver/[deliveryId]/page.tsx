import { TallyLogo } from "@/components/tally-logo";
import { notFound } from "next/navigation";
import { DriverLive } from "@/components/driver-live";
import { getDb, loadSnapshot } from "@/server/ledger";
import { localLedgerAccess } from "@/server/local-ledger-access";
import { driverModel } from "@/server/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "Delivery" };

export default async function DriverPage({
  params,
  searchParams,
}: {
  params: Promise<{ deliveryId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { deliveryId } = await params;
  const query = await searchParams;
  const model = driverModel(loadSnapshot(getDb()), deliveryId);
  if (!model) notFound();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background px-4 py-8">
      <div className="mb-8 flex items-center gap-3">
        <TallyLogo />
        <span className="font-semibold">Tally</span>
      </div>
      <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
        Driver
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        {model.heading}
      </h1>
      {query.status ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {query.status}
        </p>
      ) : null}
      <DriverLive
        id={model.id}
        initialLabel={model.label}
        initialUrl={model.url}
        paymentRequestId={localLedgerAccess() ? model.paymentRequestId : null}
      />
    </main>
  );
}
