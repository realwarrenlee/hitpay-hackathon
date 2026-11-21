import type { PaymentRequestId } from "@/domain/ids";
import { localLedgerAccess } from "@/server/local-ledger-access";
import { readEnv } from "@/server/env";
import { currentGateway } from "@/server/hitpay/current";
import { reconcilePayment } from "@/server/hitpay/webhook";
import { getDb } from "@/server/ledger";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!localLedgerAccess(true)) return Response.json({ outcome: "access_denied" }, { status: 403 });
  const { id } = await context.params;
  const result = await reconcilePayment(getDb(), currentGateway(), id as PaymentRequestId, readEnv().now);
  return Response.json({ outcome: result.outcome });
}
