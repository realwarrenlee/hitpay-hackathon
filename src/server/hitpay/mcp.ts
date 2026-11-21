import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { formatAmount, type Cents, type Result } from "@/domain/money";
import type { HitpayRequestId, InvoiceId, IsoDate, ReferenceNumber } from "@/domain/ids";
import { isAllowedTool, type AllowedTool } from "@/server/hitpay/allowlist";
import type { GatewayError, HitPayGateway } from "@/server/hitpay/gateway";
import { parseCreatedInvoice, parseInvoiceList, parsePaymentRequest, redactSecrets } from "@/server/hitpay/parse";

export interface McpConnection {
  hitpayApiKey: string;
  hitpayMcpUrl: string;
  webhookSalt: string;
  publicUrl: string;
}

export function callTool(name: string, args: unknown, transport?: (name: AllowedTool, args: unknown) => Promise<unknown>): Result<unknown, GatewayError> | Promise<Result<unknown, GatewayError>> {
  if (!isAllowedTool(name)) return { ok: false, error: { code: "tool_not_allowed", detail: name } };
  if (!transport) return { ok: false, error: { code: "transport", detail: "MCP client is not connected" } };
  return transport(name, args).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error: { code: "transport" as const, detail: error instanceof Error ? error.message : "transport" } }),
  );
}

export function mcpHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "x-hitpay-api-key": apiKey,
    "x-hitpay-environment": "sandbox",
  };
}

export function isPrivateHttpUrl(value: string): boolean {
  let host = "";
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1" || host === "0.0.0.0") return true;
  const parts = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!parts) return false;
  const a = parseInt(parts[1] ?? "", 10);
  const b = parseInt(parts[2] ?? "", 10);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return a === 172 && b >= 16 && b <= 31;
}

let webhookOmissionNoted = false;

export function paymentWebhook(publicUrl: string): string | null {
  const origin = publicUrl.trim().replace(/\/$/, "");
  if (origin && !isPrivateHttpUrl(origin)) return `${origin}/api/hitpay/webhook`;
  if (!webhookOmissionNoted) {
    webhookOmissionNoted = true;
    console.warn("HitPay webhook omitted: set PUBLIC_URL to a public origin. Payment status can still be polled with get_payment_request.");
  }
  return null;
}

export function createPaymentRequestArgs(input: { referenceNumber: ReferenceNumber; amount: Cents; purpose: string; expiresAt: string; webhookUrl: string | null }): Record<string, unknown> {
  const args: Record<string, unknown> = {
    amount: JSON.parse(formatAmount(input.amount)) as number,
    currency: "SGD",
    purpose: input.purpose,
    reference_number: input.referenceNumber,
    expiry_date: input.expiresAt,
  };
  if (input.webhookUrl) args.webhook = input.webhookUrl;
  return args;
}

export function createInvoiceArgs(input: { invoiceId: InvoiceId; customerName: string; amount: Cents; dueOn: IsoDate }): Record<string, unknown> {
  return {
    amount: JSON.parse(formatAmount(input.amount)) as number,
    currency: "SGD",
    invoice_number: input.invoiceId,
    customer_name: input.customerName,
    customer_email: "billing@example.com",
    due_date: input.dueOn,
    reference: input.invoiceId,
    send_email: false,
  };
}

function refusedHost(url: string): boolean {
  return url.includes("mcp.hit-pay.com");
}

async function withClient<T>(connection: McpConnection, run: (client: Client) => Promise<T>): Promise<T> {
  if (refusedHost(connection.hitpayMcpUrl)) throw new Error("Refusing the live HitPay MCP host");
  const client = new Client({ name: "tally", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(connection.hitpayMcpUrl), {
    requestInit: {
      headers: mcpHeaders(connection.hitpayApiKey),
    },
  });
  try {
    await client.connect(transport);
    return await run(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function masked(error: GatewayError, connection: McpConnection): GatewayError {
  return { ...error, detail: redactSecrets(error.detail, [connection.hitpayApiKey, connection.webhookSalt]) };
}

export async function listMcpToolNames(connection: McpConnection): Promise<Result<string[], GatewayError>> {
  if (!connection.hitpayApiKey) return { ok: false, error: { code: "transport", detail: "HITPAY_API_KEY is not set" } };
  try {
    const listed = await withClient(connection, (client) => client.listTools());
    return { ok: true, value: listed.tools.map((tool) => tool.name).sort() };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "transport";
    return { ok: false, error: masked({ code: "transport", detail }, connection) };
  }
}

export class McpGateway implements HitPayGateway {
  constructor(private readonly connection: McpConnection) {}

  private async invoke(name: AllowedTool, args: unknown): Promise<Result<unknown, GatewayError>> {
    if (!this.connection.hitpayApiKey) return { ok: false, error: { code: "transport", detail: "HITPAY_API_KEY is not set" } };
    if (refusedHost(this.connection.hitpayMcpUrl)) return { ok: false, error: { code: "transport", detail: "Refusing the live HitPay MCP host" } };
    const result = await callTool(name, args, (allowed, toolArgs) =>
      withClient(this.connection, (client) => client.callTool({ name: allowed, arguments: (toolArgs ?? {}) as Record<string, unknown> })),
    );
    if (!result.ok) return { ok: false, error: masked(result.error, this.connection) };
    return result;
  }

  async createInvoice(input: { invoiceId: InvoiceId; customerName: string; amount: Cents; dueOn: IsoDate }): Promise<Result<{ hitpayInvoiceId: string }, GatewayError>> {
    const result = await this.invoke("create_invoice", createInvoiceArgs(input));
    if (!result.ok) return result;
    const parsed = parseCreatedInvoice(result.value);
    return parsed.ok ? parsed : { ok: false, error: masked(parsed.error, this.connection) };
  }

  async listInvoices(): Promise<Result<readonly { hitpayInvoiceId: string; reference: string | null }[], GatewayError>> {
    const result = await this.invoke("list_invoices", { per_page: "25" });
    if (!result.ok) return result;
    const parsed = parseInvoiceList(result.value);
    if (!parsed.ok) return { ok: false, error: masked(parsed.error, this.connection) };
    return { ok: true, value: parsed.value.map((row) => ({ hitpayInvoiceId: row.hitpayInvoiceId, reference: row.reference })) };
  }

  async createPaymentRequest(input: { referenceNumber: ReferenceNumber; amount: Cents; purpose: string; expiresAt: string; webhookUrl: string }): Promise<Result<{ hitpayRequestId: HitpayRequestId; url: string; status: "pending" | "completed" | "other" }, GatewayError>> {
    const result = await this.invoke("create_payment_request", createPaymentRequestArgs({ ...input, webhookUrl: paymentWebhook(this.connection.publicUrl) }));
    if (!result.ok) return result;
    const parsed = parsePaymentRequest(result.value);
    if (!parsed.ok) return { ok: false, error: masked(parsed.error, this.connection) };
    if (parsed.value.amount !== input.amount || parsed.value.currency !== "SGD" || parsed.value.referenceNumber !== input.referenceNumber || parsed.value.purpose !== input.purpose) return { ok: false, error: { code: "unparseable", detail: "Created payment request did not match the intended SGD obligation; inspect provider state before retrying" } };
    if (!parsed.value.url) return { ok: false, error: { code: "unparseable", detail: "payment request had no checkout url" } };
    return {
      ok: true,
      value: { hitpayRequestId: parsed.value.id as HitpayRequestId, url: parsed.value.url, status: parsed.value.status },
    };
  }

  async getPaymentRequest(id: HitpayRequestId): Promise<Result<{ id: HitpayRequestId; currency: string | null; purpose: string | null; status: "pending" | "completed" | "other"; amount: Cents; referenceNumber: string }, GatewayError>> {
    const result = await this.invoke("get_payment_request", { id });
    if (!result.ok) return result;
    const parsed = parsePaymentRequest(result.value);
    if (!parsed.ok) return { ok: false, error: masked(parsed.error, this.connection) };
    return { ok: true, value: { id: parsed.value.id as HitpayRequestId, currency: parsed.value.currency, purpose: parsed.value.purpose, status: parsed.value.status, amount: parsed.value.amount, referenceNumber: parsed.value.referenceNumber } };
  }
}
