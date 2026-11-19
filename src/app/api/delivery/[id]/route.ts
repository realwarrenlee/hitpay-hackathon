import { getDb, loadSnapshot } from "@/server/ledger";
import { driverModel } from "@/server/views";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const model = driverModel(loadSnapshot(getDb()), id);
  if (!model) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ id: model.id, status: model.status, label: model.label, url: model.url, paymentRequestId: model.paymentRequestId, requestStatus: model.requestStatus });
}
