import { cents } from "../src/domain/money";
import type { HitpayRequestId, ReferenceNumber } from "../src/domain/ids";
import { readSandboxSmoke } from "../src/server/env";
import { listMcpToolNames, McpGateway, paymentWebhook } from "../src/server/hitpay/mcp";
import { redactSecrets } from "../src/server/hitpay/parse";
import { signBody, verifySignature } from "../src/server/hitpay/webhook";

function sgtExpiry(): string {
  const when = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000);
  const year = when.getUTCFullYear();
  const month = String(when.getUTCMonth() + 1).padStart(2, "0");
  const day = String(when.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day} 23:59:59`;
}

async function main() {
  let config: ReturnType<typeof readSandboxSmoke>;
  try {
    config = readSandboxSmoke();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "configuration");
    process.exit(1);
  }
  if ("skip" in config) {
    console.log(config.skip);
    return;
  }

  const connection = { hitpayApiKey: config.apiKey, hitpayMcpUrl: config.mcpUrl, webhookSalt: config.salt, publicUrl: config.publicUrl };
  const quiet = (text: string) => redactSecrets(text, [config.apiKey, config.salt]);
  const gateway = new McpGateway(connection);
  try {
  await smoke(config, connection, gateway, quiet);
  } catch (error) {
    console.error(quiet(error instanceof Error ? error.message : "smoke failed"));
    process.exit(1);
  }
}

async function smoke(
  config: { mcpUrl: string; apiKey: string; salt: string; appUrl: string; publicUrl: string },
  connection: { hitpayApiKey: string; hitpayMcpUrl: string; webhookSalt: string; publicUrl: string },
  gateway: McpGateway,
  quiet: (text: string) => string,
) {
  const results: { name: string; ok: boolean }[] = [];
  const note = (name: string, ok: boolean, detail: string) => {
    results.push({ name, ok });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  };

  const tools = await listMcpToolNames(connection).catch((error: unknown) => ({ ok: false as const, error: { detail: error instanceof Error ? error.message : "transport" } }));
  if (tools.ok) {
    note("list tools", true, String(tools.value.length));
    for (const name of tools.value) console.log(name);
  } else {
    note("list tools", false, quiet(tools.error.detail));
  }

  const reference = `TALLY-SMOKE-${Date.now()}` as ReferenceNumber;
  const webhook = paymentWebhook(config.publicUrl);
  if (webhook) console.log(`webhook ${webhook}`);
  let createdId: HitpayRequestId | null = null;
  const created = await gateway.createPaymentRequest({
    referenceNumber: reference,
    amount: cents(3840),
    purpose: "Tally sandbox smoke",
    expiresAt: sgtExpiry(),
    webhookUrl: webhook ?? "",
  }).catch((error: unknown) => ({ ok: false as const, error: { detail: error instanceof Error ? error.message : "transport" } }));
  if (created.ok) {
    createdId = created.value.hitpayRequestId;
    note("create_payment_request", true, `id=${created.value.hitpayRequestId} status=${created.value.status} url=${created.value.url}`);
  } else {
    note("create_payment_request", false, quiet(created.error.detail));
  }

  if (!createdId) {
    note("get_payment_request", false, "create did not return an id");
  } else {
    const readBack = await gateway.getPaymentRequest(createdId).catch((error: unknown) => ({ ok: false as const, error: { detail: error instanceof Error ? error.message : "transport" } }));
    if (!readBack.ok) {
      note("get_payment_request", false, quiet(readBack.error.detail));
    } else {
      const centsBack = readBack.value.amount as number;
      const matched = centsBack === 3840 && readBack.value.status === "pending" && readBack.value.referenceNumber === reference;
      note("get_payment_request", matched, matched ? "cents=3840 status=pending" : `cents=${centsBack} status=${readBack.value.status} reference=${readBack.value.referenceNumber}`);
    }
  }

  const invoices = await gateway.listInvoices().catch((error: unknown) => ({ ok: false as const, error: { detail: error instanceof Error ? error.message : "transport" } }));
  if (!invoices.ok) {
    note("list_invoices", false, quiet(invoices.error.detail));
  } else {
    note("list_invoices", true, String(invoices.value.length));
    for (const invoice of invoices.value.slice(0, 50)) console.log(`invoice ${invoice.hitpayInvoiceId} reference=${invoice.reference ?? ""}`);
  }

  const sample = JSON.stringify({
    event_type: "payment_request.completed",
    payment_request_id: createdId ?? "smoke",
    reference_number: reference,
    amount: "38.40",
    status: "completed",
  });
  const raw = new TextEncoder().encode(sample);
  const header = signBody(raw, config.salt);
  const signedOk = verifySignature(raw, header, config.salt);
  const tamperedOk = verifySignature(new TextEncoder().encode(sample.replace("38.40", "38.41")), header, config.salt);
  if (signedOk && !tamperedOk) note("webhook signature", true, "signed body accepted, tampered body rejected");
  else if (!signedOk) note("webhook signature", false, "signed body was rejected");
  else note("webhook signature", false, "tampered body was accepted");

  const passed = results.filter((row) => row.ok).length;
  const failed = results.length - passed;
  console.log(`summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "smoke failed");
  process.exit(1);
});
