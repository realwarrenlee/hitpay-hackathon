import { readEnv } from "@/server/env";
import { ensureReviewHints } from "@/server/flow";
import { getDb } from "@/server/ledger";

export const dynamic = "force-dynamic";

export async function POST() {
  await ensureReviewHints(getDb(), readEnv().now);
  return Response.json({ ready: true });
}
