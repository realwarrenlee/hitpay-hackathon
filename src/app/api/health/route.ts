import { readEnv } from "@/server/env";
import { getDb, loadSnapshot } from "@/server/ledger";

export const dynamic = "force-dynamic";

export function GET() {
  const env = readEnv();
  const invoices = loadSnapshot(getDb()).invoices.size;
  return Response.json({ ok: true, db: env.dbPath, invoices });
}
