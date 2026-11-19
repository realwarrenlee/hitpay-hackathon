import type { Brand } from "@/domain/money";

export type CustomerId = Brand<string, "CustomerId">;
export type InvoiceId = Brand<string, "InvoiceId">;
export type CreditId = Brand<string, "CreditId">;
export type SuggestionId = Brand<string, "SuggestionId">;
export type AllocationId = Brand<string, "AllocationId">;
export type DeliveryId = Brand<string, "DeliveryId">;
export type PaymentRequestId = Brand<string, "PaymentRequestId">;
export type HitpayRequestId = Brand<string, "HitpayRequestId">;
export type ImportBatchId = Brand<string, "ImportBatchId">;
export type ReceiptId = Brand<string, "ReceiptId">;
export type DedupeKey = Brand<string, "DedupeKey">;
export type IsoDate = Brand<string, "IsoDate">;
export type Instant = Brand<string, "Instant">;
export type ReferenceNumber = Brand<string, "ReferenceNumber">;

export function asInvoiceId(value: string): InvoiceId {
  if (!/^INV-\d{3,6}$/.test(value)) throw new Error(`bad invoice id ${value}`);
  return value as InvoiceId;
}

export function asIsoDate(value: string): IsoDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`bad date ${value}`);
  return value as IsoDate;
}
