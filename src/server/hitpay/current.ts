import { readEnv } from "@/server/env";
import { FakeGateway } from "@/server/hitpay/fake";
import type { HitPayGateway } from "@/server/hitpay/gateway";
import { McpGateway } from "@/server/hitpay/mcp";

const globalStore = globalThis as typeof globalThis & { __tallyFake?: FakeGateway; __tallyMcp?: McpGateway };

export function currentGateway(): HitPayGateway {
  const env = readEnv();
  if (env.gateway === "mcp") {
    if (!globalStore.__tallyMcp) {
      globalStore.__tallyMcp = new McpGateway({
        hitpayApiKey: env.hitpayApiKey,
        hitpayMcpUrl: env.hitpayMcpUrl,
        webhookSalt: env.webhookSalt,
        publicUrl: env.publicUrl,
      });
    }
    return globalStore.__tallyMcp;
  }
  if (!globalStore.__tallyFake) globalStore.__tallyFake = new FakeGateway(env.appUrl);
  return globalStore.__tallyFake;
}
