import type { Instant, IsoDate } from "@/domain/ids";

export interface AppEnv {
  hitpayApiKey: string;
  hitpayEnv: "sandbox";
  hitpayMcpUrl: string;
  webhookSalt: string;
  dbUrl: string;
  dbPath: string;
  appUrl: string;
  publicUrl: string;
  gateway: "fake" | "mcp";
  hintsApiUrl: string;
  hintsApiKey: string;
  hintsModel: string;
  hintsTimeoutMs: number;
  stripe: boolean;
  autoApproveRemainder: boolean;
  today: IsoDate;
  now: Instant;
}

function hintsTimeoutMs(): number {
  const raw = process.env.HINTS_TIMEOUT_MS?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return 20000;
  const value = parseInt(raw, 10);
  if (value < 1) return 20000;
  return value;
}

function sqlitePath(url: string): string {
  if (url === ":memory:") return ":memory:";
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

export function readEnv(): AppEnv {
  const hitpayEnv = process.env.HITPAY_ENV?.trim() || "sandbox";
  if (hitpayEnv !== "sandbox") {
    throw new Error("HITPAY_ENV must be sandbox");
  }
  const hitpayMcpUrl = process.env.HITPAY_MCP_URL?.trim() || "https://hitpay-mcp.vercel.app/api/mcp";
  if (hitpayMcpUrl.includes("mcp.hit-pay.com")) {
    throw new Error("Refusing the live HitPay MCP host");
  }
  const hitpayApiKey = process.env.HITPAY_API_KEY?.trim() ?? "";
  const requested = process.env.TALLY_GATEWAY?.trim();
  const gateway = requested === "mcp" || requested === "fake" ? requested : hitpayApiKey ? "mcp" : "fake";
  if (gateway === "fake" && process.env.NODE_ENV === "production") {
    throw new Error("TALLY_GATEWAY=fake is refused in production");
  }
  const webhookSalt = process.env.HITPAY_WEBHOOK_SALT?.trim() || (gateway === "fake" ? "tally-fake-salt" : "");
  if (!webhookSalt) throw new Error("HITPAY_WEBHOOK_SALT is required");
  const dbUrl = process.env.TALLY_DB_URL?.trim() || "file:./data/tally.db";
  const now = (process.env.TALLY_NOW?.trim() || new Date().toISOString().replace("Z", "+00:00")) as Instant;
  return {
    hitpayApiKey,
    hitpayEnv: "sandbox",
    hitpayMcpUrl,
    webhookSalt,
    dbUrl,
    dbPath: sqlitePath(dbUrl),
    appUrl: process.env.APP_URL?.trim() || "http://127.0.0.1:43123",
    publicUrl: process.env.PUBLIC_URL?.trim() || "",
    gateway,
    hintsApiUrl: process.env.HINTS_API_URL?.trim() || "https://api.openai.com/v1",
    hintsApiKey: process.env.HINTS_API_KEY?.trim() || "",
    hintsModel: process.env.HINTS_MODEL?.trim() || "gpt-6.1-terra",
    hintsTimeoutMs: hintsTimeoutMs(),
    stripe: process.env.TALLY_STRIPE?.trim() === "on",
    autoApproveRemainder: (process.env.TALLY_AUTO_APPROVE_REMAINDER?.trim() || "on") !== "off",
    today: (process.env.TALLY_TODAY?.trim() || "2026-11-17") as IsoDate,
    now,
  };
}

export function readSandboxSmoke(): { skip: string } | { mcpUrl: string; apiKey: string; salt: string; appUrl: string; publicUrl: string } {
  const apiKey = process.env.HITPAY_API_KEY?.trim() ?? "";
  if (!apiKey) return { skip: "HitPay sandbox smoke skipped: HITPAY_API_KEY is not set." };
  const mcpUrl = process.env.HITPAY_MCP_URL?.trim() || "https://hitpay-mcp.vercel.app/api/mcp";
  if (mcpUrl.includes("mcp.hit-pay.com")) throw new Error("Refusing the live HitPay MCP host");
  const salt = process.env.HITPAY_WEBHOOK_SALT?.trim() ?? "";
  if (!salt) throw new Error("HITPAY_WEBHOOK_SALT is required");
  return {
    mcpUrl,
    apiKey,
    salt,
    appUrl: process.env.APP_URL?.trim() || "http://127.0.0.1:43123",
    publicUrl: process.env.PUBLIC_URL?.trim() || "",
  };
}

export function readLocalPolicyMode(): boolean {
  return process.env.NODE_ENV === "development" && process.env.TALLY_LOCAL_POLICY_EDITS === "on";
}
