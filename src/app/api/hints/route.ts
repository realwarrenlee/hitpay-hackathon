import { localLedgerAccess } from "@/server/local-ledger-access";
import { readEnv } from "@/server/env";
import { ensureReviewHints } from "@/server/flow";
import { getDb } from "@/server/ledger";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!localLedgerAccess(true)) return Response.json({ outcome: "access_denied" }, { status: 403 });
  await ensureReviewHints(getDb(), readEnv().now);
  return Response.json({ ready: true });
}
