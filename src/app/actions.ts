"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatAmount } from "@/domain/money";
import { asInvoiceId, type AllocationId, type CustomerId, type DeliveryId, type PaymentRequestId, type SuggestionId } from "@/domain/ids";
import { readEnv } from "@/server/env";
import {
  approveCustomerHold,
  approveSuggestion,
  checkCutoff,
  importBytes,
  rejectSuggestion,
  requestRemainder,
  undoAllocation,
} from "@/server/flow";
import { currentGateway } from "@/server/hitpay/current";
import { handleWebhook, reconcilePayment, signBody } from "@/server/hitpay/webhook";
import { localLedgerAccess, LOCAL_OPERATOR } from "@/server/local-ledger-access";
import { getDb, loadSnapshot, run } from "@/server/ledger";

function go(path: string, status?: string): never {
  const target = status ? `${path}?status=${encodeURIComponent(status)}` : path;
  revalidatePath("/", "layout");
  redirect(target);
}

export async function importAction(formData: FormData) {
  if (!localLedgerAccess(true)) go("/deliveries", "access_denied");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) go("/import", "Choose a bank CSV first.");
  const bytes = new Uint8Array(await (file as File).arrayBuffer());
  const result = await importBytes(getDb(), bytes, (file as File).name, LOCAL_OPERATOR);
  go("/import", result.ok ? result.status : `${result.error.code} on line ${"fileLine" in result.error ? result.error.fileLine : ""}`);
}

export async function approveAction(formData: FormData) {
  if (!localLedgerAccess(true)) go("/deliveries", "access_denied");
  const suggestionId = String(formData.get("suggestionId")) as SuggestionId;
  const pick = formData.get("pick");
  const result = approveSuggestion(getDb(), suggestionId, pick ? asInvoiceId(String(pick)) : null, LOCAL_OPERATOR);
  go("/review", result.ok ? "Approved." : result.error.code);
}

export async function approvePreselectedAction(formData: FormData) {
  if (!localLedgerAccess(true)) go("/deliveries", "access_denied");
  const ids = formData.getAll("suggestionId");
  if (!ids.length || ids.length > 1000 || ids.some((id) => typeof id !== "string" || !id)) go("/review", "selection_required");
  const result = run(getDb(), { kind: "approve_preselected", suggestionIds: ids as SuggestionId[], by: LOCAL_OPERATOR });
  go("/review", result.ok ? "Selected allocations approved." : result.error.code);
}

export async function approveSplitAction(formData: FormData) {
  if (!localLedgerAccess(true)) go("/deliveries", "access_denied");
  const result = approveSuggestion(getDb(), String(formData.get("suggestionId")) as SuggestionId, null, LOCAL_OPERATOR);
  go("/review", result.ok ? "Split approved." : result.error.code);
}

export async function rejectAction(formData: FormData) {
  if (!localLedgerAccess(true)) go("/deliveries", "access_denied");
  const result = rejectSuggestion(getDb(), String(formData.get("suggestionId")) as SuggestionId, LOCAL_OPERATOR);
  go("/review", result.ok ? "Rejected." : result.error.code);
}

export async function undoAction(formData: FormData) {
  if (!localLedgerAccess(true)) go("/deliveries", "access_denied");
  const result = undoAllocation(getDb(), String(formData.get("allocationId")), LOCAL_OPERATOR);
  go("/review", result.ok ? "Undone." : result.error.code);
}

export async function commitAction(formData: FormData) {
  if (!localLedgerAccess(true)) go("/deliveries", "access_denied");
  const ids = formData.getAll("allocationId");
  if (!ids.length || ids.length > 1000 || ids.some((id) => typeof id !== "string" || !id)) go("/review", "selection_required");
  const result = run(getDb(), { kind: "commit_approved", allocationIds: ids as AllocationId[], by: LOCAL_OPERATOR });
  go("/review", result.ok ? "Allocations reconciled." : result.error.code);
}

export async function requestRemainderAction(formData: FormData) {
  if (!localLedgerAccess(true)) go("/deliveries", "access_denied");
  const result = await requestRemainder(getDb(), currentGateway(), asInvoiceId(String(formData.get("invoiceId"))), LOCAL_OPERATOR);
  go("/review", result.ok ? "Payment request ready." : result.error.code);
}

export async function approveHoldAction(formData: FormData) {
  if (!localLedgerAccess(true)) go("/deliveries", "access_denied");
  const customerId = String(formData.get("customerId"));
  const result = await approveCustomerHold(getDb(), currentGateway(), customerId as CustomerId, LOCAL_OPERATOR, readEnv().now, String(formData.get("deliveryId")) as DeliveryId);
  go(`/customer/${customerId}`, result.ok ? "Hold: pay-first" : result.error.code);
}

export async function rejectHoldAction(formData: FormData) {
  if (!localLedgerAccess(true)) go("/deliveries", "access_denied");
  const customerId = String(formData.get("customerId"));
  const result = run(getDb(), { kind: "reject_hold", expectedDeliveryId: String(formData.get("deliveryId")) as DeliveryId, customerId: customerId as CustomerId, by: LOCAL_OPERATOR, reason: String(formData.get("reason") ?? "") });
  go(`/customer/${customerId}`, result.ok ? "Hold: normal" : result.error.code);
}

export async function overrideHoldAction(formData: FormData) {
  if (!localLedgerAccess(true)) go("/deliveries", "access_denied");
  const customerId = String(formData.get("customerId"));
  const result = run(getDb(), { kind: "override_hold", expectedDeliveryId: String(formData.get("deliveryId")) as DeliveryId, customerId: customerId as CustomerId, by: LOCAL_OPERATOR, reason: String(formData.get("reason") ?? "") });
  go(`/customer/${customerId}`, result.ok ? "Hold: normal" : result.error.code);
}

export async function checkCutoffAction(formData: FormData) {
  if (!localLedgerAccess(true)) go("/deliveries", "access_denied");
  const raw = String(formData.get("customerId") || "all");
  const customerId = (raw === "all" ? "all" : raw) as CustomerId | "all";
  checkCutoff(getDb(), customerId, LOCAL_OPERATOR);
  go(customerId === "all" ? "/customer" : `/customer/${customerId}`, "Cut-Off checked.");
}

function localPath(value: FormDataEntryValue | null, fallback: string) {
  const path = String(value ?? "");
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  return path;
}

export async function checkPaymentStatusAction(formData: FormData) {
  if (!localLedgerAccess(true)) go("/deliveries", "access_denied");
  const id = String(formData.get("paymentRequestId")) as PaymentRequestId;
  const back = localPath(formData.get("returnTo"), "/review");
  const result = await reconcilePayment(getDb(), currentGateway(), id, readEnv().now);
  const message =
    result.outcome === "applied"
      ? "Payment recorded."
      : result.outcome === "pending"
        ? "Still pending at HitPay."
        : result.outcome === "amount_mismatch"
          ? "Payment amounts differ. No automatic allocation or delivery release occurred. Review Audit and payment evidence."
          : result.outcome === "other"
            ? "HitPay did not mark this payment completed."
            : result.outcome === "unknown_reference"
              ? "HitPay reference does not match this request."
              : result.outcome;
  go(back, message);
}

export async function simulatePayAction(formData: FormData) {
  if (!localLedgerAccess(true)) go("/deliveries", "access_denied");
  const id = String(formData.get("id"));
  const gateway = currentGateway();
  // A cached fake adapter can come from a different dev bundle's constructor.
  if (readEnv().gateway !== "fake" || !("markStatus" in gateway) || typeof gateway.markStatus !== "function") go(`/pay/fake/${id}`, "Simulated checkout is unavailable in this payment mode.");
  gateway.markStatus(id, "completed");
  const request = [...loadSnapshot(getDb()).paymentRequests.values()].find((row) => row.hitpayRequestId === id);
  if (!request) go(`/pay/fake/${id}`, "This checkout is not on the book.");
  const body = JSON.stringify({
    event_type: "payment_request.completed",
    payment_request_id: id,
    reference_number: request?.referenceNumber,
    amount: request ? formatAmount(request.amount) : "0.00",
    status: "completed",
  });
  const raw = new TextEncoder().encode(body);
  const headers = new Headers({ "hitpay-signature": signBody(raw, readEnv().webhookSalt) });
  const result = await handleWebhook(getDb(), raw, headers, gateway, readEnv().now);
  go(`/pay/fake/${id}`, result.status === 200 && result.body.outcome === "applied" ? "Payment recorded." : `Payment not applied: ${result.body.outcome}. Review the delivery and payment evidence.`);
}
