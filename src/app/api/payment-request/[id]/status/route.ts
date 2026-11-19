import type { PaymentRequestId } from "@/domain/ids";
import { readEnv } from "@/server/env";
import { currentGateway } from "@/server/hitpay/current";
import { reconcilePayment } from "@/server/hitpay/webhook";
import { getDb } from "@/server/ledger";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await reconcilePayment(getDb(), currentGateway(), id as PaymentRequestId, readEnv().now);
  return Response.json({ outcome: result.outcome });
}
