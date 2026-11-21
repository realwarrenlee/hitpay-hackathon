import type { Cents, Result } from "@/domain/money";
import type { HitpayRequestId, InvoiceId, IsoDate, ReferenceNumber } from "@/domain/ids";

export type GatewayError = { code: "tool_not_allowed" | "transport" | "tool_error" | "unparseable"; detail: string };

export interface HitPayGateway {
  createInvoice(input: { invoiceId: InvoiceId; customerName: string; amount: Cents; dueOn: IsoDate }): Promise<Result<{ hitpayInvoiceId: string }, GatewayError>>;
  listInvoices(): Promise<Result<readonly { hitpayInvoiceId: string; reference: string | null }[], GatewayError>>;
  createPaymentRequest(input: { referenceNumber: ReferenceNumber; amount: Cents; purpose: string; expiresAt: string; webhookUrl: string }): Promise<Result<{ hitpayRequestId: HitpayRequestId; url: string; status: "pending" | "completed" | "other" }, GatewayError>>;
  getPaymentRequest(id: HitpayRequestId): Promise<Result<{ id: HitpayRequestId; currency: string | null; purpose: string | null; status: "pending" | "completed" | "other"; amount: Cents; referenceNumber: string }, GatewayError>>;
}
