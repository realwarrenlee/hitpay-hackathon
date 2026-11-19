import { currentGateway } from "@/server/hitpay/current";
import { handleWebhook } from "@/server/hitpay/webhook";
import { getDb } from "@/server/ledger";
import { readEnv } from "@/server/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const raw = new Uint8Array(await request.arrayBuffer());
  const result = await handleWebhook(getDb(), raw, request.headers, currentGateway(), readEnv().now);
  return Response.json({ ok: result.status === 200 }, { status: result.status });
}
