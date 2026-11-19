import { execSync } from "node:child_process";
import { violations } from "@/domain/invariants";
import { readEnv } from "@/server/env";
import { getDb, loadSnapshot } from "@/server/ledger";
import { ALLOWED_TOOLS } from "@/server/hitpay/allowlist";

export function doctorReport() {
  const env = readEnv();
  const snap = loadSnapshot(getDb());
  let sha = "unknown";
  try {
    sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    sha = "unknown";
  }
  return {
    sha,
    db: env.dbPath,
    hitpayEnv: env.hitpayEnv,
    gateway: env.gateway,
    allowlist: ALLOWED_TOOLS,
    saltSet: env.webhookSalt.length > 0,
    hints: env.hintsApiKey ? "llm" : "regex",
    invoices: snap.invoices.size,
    violations: violations(snap),
  };
}
