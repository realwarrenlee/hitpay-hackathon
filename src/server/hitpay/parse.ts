import { z } from "zod";
import { parseSgd, type Cents, type Result } from "@/domain/money";
import type { GatewayError } from "@/server/hitpay/gateway";

const MoneyInput = z.union([z.string(), z.number()]);

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out.slice(0, 500);
}

function unparseable(detail: string): Result<never, GatewayError> {
  return { ok: false, error: { code: "unparseable", detail } };
}

const CURRENCY_AMOUNT = /^([A-Z]{3}) (-?\d+(?:\.\d{1,2})?)$/;

function decimalText(value: string | number): { currency: string | null; text: string } | null {
  if (typeof value === "string") {
    const match = CURRENCY_AMOUNT.exec(value.trim());
    if (match) return { currency: match[1] ?? null, text: match[2] ?? "" };
    return { currency: null, text: value };
  }
  if (!Number.isFinite(value)) return null;
  const text = value.toString();
  if (/e/i.test(text)) return null;
  return { currency: null, text };
}

export function centsFromMajor(value: string | number): Result<Cents, GatewayError> {
  const parts = decimalText(value);
  if (parts == null) return unparseable("amount was not a decimal");
  if (parts.currency && parts.currency !== "SGD") return unparseable("amount currency");
  const parsed = parseSgd(parts.text);
  if (!parsed.ok) return unparseable(`amount ${parsed.error.code}`);
  return { ok: true, value: parsed.value };
}

export function paymentStatus(status: string): "pending" | "completed" | "other" {
  if (status === "pending") return "pending";
  if (status === "completed") return "completed";
  return "other";
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object" || !("text" in block)) return "";
      const text = (block as { text: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

export function unwrapMcpPayload(value: unknown): Result<unknown, GatewayError> {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!record) return unparseable("mcp result was not an object");
  const body = record.result && typeof record.result === "object" ? (record.result as Record<string, unknown>) : record;
  if (body.isError === true) {
    const detail = textOf(body.content).trim() || "tool error";
    return { ok: false, error: { code: "tool_error", detail: detail.slice(0, 500) } };
  }
  if (body.structuredContent !== undefined) return { ok: true, value: body.structuredContent };
  if (Array.isArray(body.content)) {
    const text = textOf(body.content).trim();
    if (!text) return unparseable("mcp result had no text");
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      return unparseable("mcp result text was not json");
    }
  }
  return { ok: true, value: body };
}

const PaymentRequestSchema = z
  .object({
    id: z.string().min(1),
    amount: MoneyInput,
    status: z.string().min(1),
    reference_number: z.string().min(1),
    currency: z.string().optional(),
    purpose: z.string().optional(),
    url: z.string().min(1).optional(),
    checkout_url: z.string().min(1).optional(),
  })
  .passthrough();

export interface ParsedPaymentRequest {
  currency: string | null;
  purpose: string | null;
  id: string;
  amount: Cents;
  status: "pending" | "completed" | "other";
  referenceNumber: string;
  url: string | null;
}

export function parsePaymentRequest(payload: unknown): Result<ParsedPaymentRequest, GatewayError> {
  const unwrapped = unwrapMcpPayload(payload);
  if (!unwrapped.ok) return unwrapped;
  const parsed = PaymentRequestSchema.safeParse(unwrapped.value);
  if (!parsed.success) return unparseable("payment request shape");
  const amount = centsFromMajor(parsed.data.amount);
  if (!amount.ok) return amount;
  return {
    ok: true,
    value: {
      id: parsed.data.id,
      currency: parsed.data.currency?.toUpperCase() ?? (typeof parsed.data.amount === "string" ? CURRENCY_AMOUNT.exec(parsed.data.amount.trim())?.[1] ?? null : null),
      purpose: parsed.data.purpose ?? null,
      amount: amount.value,
      status: paymentStatus(parsed.data.status),
      referenceNumber: parsed.data.reference_number,
      url: parsed.data.checkout_url ?? parsed.data.url ?? null,
    },
  };
}

const InvoiceItemSchema = z
  .object({
    id: z.string().min(1),
    reference: z.string().nullable().optional(),
    amount: MoneyInput.optional(),
  })
  .passthrough();

function invoiceRows(value: unknown): z.infer<typeof InvoiceItemSchema>[] | null {
  if (Array.isArray(value)) {
    const parsed = z.array(InvoiceItemSchema).safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const list = "invoices" in record ? record.invoices : record.data;
  if (!Array.isArray(list)) return null;
  const parsed = z.array(InvoiceItemSchema).safeParse(list);
  return parsed.success ? parsed.data : null;
}

export interface ParsedInvoice {
  hitpayInvoiceId: string;
  reference: string | null;
  amount: Cents | null;
}

export function parseInvoiceList(payload: unknown): Result<ParsedInvoice[], GatewayError> {
  const unwrapped = unwrapMcpPayload(payload);
  if (!unwrapped.ok) return unwrapped;
  const rows = invoiceRows(unwrapped.value);
  if (!rows) return unparseable("invoice list shape");
  const out: ParsedInvoice[] = [];
  for (const row of rows) {
    let amount: Cents | null = null;
    if (row.amount !== undefined) {
      const cents = centsFromMajor(row.amount);
      if (!cents.ok) return cents;
      amount = cents.value;
    }
    out.push({ hitpayInvoiceId: row.id, reference: row.reference ?? null, amount });
  }
  return { ok: true, value: out };
}

function createdInvoiceId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string" && record.id.length > 0) return record.id;
  const nested = record.data;
  if (nested && typeof nested === "object") {
    const id = (nested as Record<string, unknown>).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

export function parseCreatedInvoice(payload: unknown): Result<{ hitpayInvoiceId: string }, GatewayError> {
  const unwrapped = unwrapMcpPayload(payload);
  if (!unwrapped.ok) return unwrapped;
  const id = createdInvoiceId(unwrapped.value);
  if (!id) return unparseable("invoice shape");
  return { ok: true, value: { hitpayInvoiceId: id } };
}
