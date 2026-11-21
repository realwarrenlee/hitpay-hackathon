import { randomUUID } from "node:crypto";
import { formatAmount, type Cents, type Result } from "@/domain/money";
import type { HitpayRequestId, InvoiceId, IsoDate, ReferenceNumber } from "@/domain/ids";
import type { GatewayError, HitPayGateway } from "@/server/hitpay/gateway";

interface StoredRequest {
  purpose: string;
  status: "pending" | "completed" | "other";
  amount: Cents;
  referenceNumber: string;
  url: string;
}

export class FakeGateway implements HitPayGateway {
  readonly calls: { tool: string; args: Record<string, string> }[] = [];
  private readonly requests = new Map<string, StoredRequest>();

  constructor(private readonly appUrl = "http://127.0.0.1:43123") {}

  async createInvoice(input: { invoiceId: InvoiceId; customerName: string; amount: Cents; dueOn: IsoDate }): Promise<Result<{ hitpayInvoiceId: string }, GatewayError>> {
    this.calls.push({ tool: "create_invoice", args: { invoiceId: input.invoiceId, amount: formatAmount(input.amount) } });
    return { ok: true, value: { hitpayInvoiceId: `inv_fake_${input.invoiceId}` } };
  }

  async listInvoices(): Promise<Result<readonly { hitpayInvoiceId: string; reference: string | null }[], GatewayError>> {
    this.calls.push({ tool: "list_invoices", args: {} });
    return { ok: true, value: [] };
  }

  async createPaymentRequest(input: { referenceNumber: ReferenceNumber; amount: Cents; purpose: string; expiresAt: string; webhookUrl: string }): Promise<Result<{ hitpayRequestId: HitpayRequestId; url: string; status: "pending" | "completed" | "other" }, GatewayError>> {
    const id = `hitpay_fake_${randomUUID()}` as HitpayRequestId;
    const url = `${this.appUrl}/pay/fake/${id}`;
    this.requests.set(id, { status: "pending", purpose: input.purpose, amount: input.amount, referenceNumber: input.referenceNumber, url });
    this.calls.push({
      tool: "create_payment_request",
      args: { amount: formatAmount(input.amount), reference_number: input.referenceNumber, purpose: input.purpose, webhook: input.webhookUrl },
    });
    return { ok: true, value: { hitpayRequestId: id, url, status: "pending" as const } };
  }

  async getPaymentRequest(id: HitpayRequestId): Promise<Result<{ id: HitpayRequestId; currency: string | null; purpose: string | null; status: "pending" | "completed" | "other"; amount: Cents; referenceNumber: string }, GatewayError>> {
    const stored = this.requests.get(id);
    this.calls.push({ tool: "get_payment_request", args: { id } });
    if (!stored) return { ok: false, error: { code: "tool_error", detail: "unknown payment request" } };
    return { ok: true, value: { id, currency: "SGD", purpose: stored.purpose, status: stored.status, amount: stored.amount, referenceNumber: stored.referenceNumber } };
  }

  put(id: string, amount: Cents, referenceNumber: string, status: StoredRequest["status"]) {
    this.requests.set(id, { status, purpose: referenceNumber.includes("DLV-") ? "pay_first" : "remainder", amount, referenceNumber, url: `${this.appUrl}/pay/fake/${id}` });
  }

  markStatus(id: string, status: StoredRequest["status"]) {
    const stored = this.requests.get(id);
    if (stored) stored.status = status;
  }

  markAmount(id: string, amount: Cents) {
    const stored = this.requests.get(id);
    if (stored) stored.amount = amount;
  }
}
