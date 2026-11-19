"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatAmount } from "@/domain/money";
import { asInvoiceId, type CustomerId, type PaymentRequestId, type SuggestionId } from "@/domain/ids";
import { readEnv } from "@/server/env";
import {
  approveCustomerHold,
  approvePreselected,
  approveSuggestion,
  checkCutoff,
  commitApproved,
  importBytes,
  OWNER,
  rejectSuggestion,
  requestRemainder,
  undoAllocation,
} from "@/server/flow";
import { currentGateway } from "@/server/hitpay/current";
import { handleWebhook, reconcilePayment, signBody } from "@/server/hitpay/webhook";
import { getDb, loadSnapshot, run } from "@/server/ledger";

function go(path: string, status?: string): never {
  const target = status ? `${path}?status=${encodeURIComponent(status)}` : path;
  revalidatePath("/", "layout");
  redirect(target);
}

export async function importAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) go("/import", "Choose a bank CSV first.");
  const bytes = new Uint8Array(await (file as File).arrayBuffer());
  const result = await importBytes(getDb(), bytes, (file as File).name);
  go("/import", result.ok ? result.status : `${result.error.code} on line ${"fileLine" in result.error ? result.error.fileLine : ""}`);
}

export async function approveAction(formData: FormData) {
  const suggestionId = String(formData.get("suggestionId")) as SuggestionId;
  const pick = formData.get("pick");
  const result = approveSuggestion(getDb(), suggestionId, pick ? asInvoiceId(String(pick)) : null);
  go("/review", result.ok ? "Approved." : result.error.code);
}

export async function approvePreselectedAction() {
  const result = approvePreselected(getDb());
  go("/review", result.ok ? "Pre-ticked credits approved." : result.error.code);
}

export async function approveSplitAction(formData: FormData) {
  const result = approveSuggestion(getDb(), String(formData.get("suggestionId")) as SuggestionId, null);
  go("/review", result.ok ? "Split approved." : result.error.code);
}

export async function rejectAction(formData: FormData) {
  const result = rejectSuggestion(getDb(), String(formData.get("suggestionId")) as SuggestionId);
  go("/review", result.ok ? "Rejected." : result.error.code);
}

export async function undoAction(formData: FormData) {
  const result = undoAllocation(getDb(), String(formData.get("allocationId")));
  go("/review", result.ok ? "Undone." : result.error.code);
}

export async function commitAction() {
  const result = commitApproved(getDb());
  go("/review", result.ok ? "Committed." : result.error.code);
}

export async function requestRemainderAction(formData: FormData) {
  const result = await requestRemainder(getDb(), currentGateway(), asInvoiceId(String(formData.get("invoiceId"))));
  go("/review", result.ok ? "Payment request ready." : result.error.code);
}

export async function approveHoldAction(formData: FormData) {
  const customerId = String(formData.get("customerId"));
  const result = await approveCustomerHold(getDb(), currentGateway(), customerId as CustomerId);
  go(`/customer/${customerId}`, result.ok ? "Hold: pay-first" : result.error.code);
}

export async function rejectHoldAction(formData: FormData) {
  const customerId = String(formData.get("customerId"));
  const result = run(getDb(), { kind: "reject_hold", customerId: customerId as CustomerId, by: OWNER, reason: "Keep this delivery on credit" });
  go(`/customer/${customerId}`, result.ok ? "Hold: normal" : result.error.code);
}

export async function overrideHoldAction(formData: FormData) {
  const customerId = String(formData.get("customerId"));
  const result = run(getDb(), { kind: "override_hold", customerId: customerId as CustomerId, by: OWNER, reason: "Owner override" });
  go(`/customer/${customerId}`, result.ok ? "Hold: normal" : result.error.code);
}

export async function checkCutoffAction(formData: FormData) {
  const raw = String(formData.get("customerId") || "all");
  const customerId = (raw === "all" ? "all" : raw) as CustomerId | "all";
  checkCutoff(getDb(), customerId);
  go(customerId === "all" ? "/customer" : `/customer/${customerId}`, "Cut-Off checked.");
}

function localPath(value: FormDataEntryValue | null, fallback: string) {
  const path = String(value ?? "");
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  return path;
}

export async function checkPaymentStatusAction(formData: FormData) {
  const id = String(formData.get("paymentRequestId")) as PaymentRequestId;
  const back = localPath(formData.get("returnTo"), "/review");
  const result = await reconcilePayment(getDb(), currentGateway(), id, readEnv().now);
  const message =
    result.outcome === "applied"
      ? "Payment recorded."
      : result.outcome === "pending"
        ? "Still pending at HitPay."
        : result.outcome === "amount_mismatch"
          ? "Amount does not match the request. It is in the review queue and was not applied."
          : result.outcome === "other"
            ? "HitPay did not mark this payment completed."
            : result.outcome === "unknown_reference"
              ? "HitPay reference does not match this request."
              : "Could not read this payment from HitPay.";
  go(back, message);
}

export async function simulatePayAction(formData: FormData) {
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
  go(`/pay/fake/${id}`, result.status === 200 ? "Payment recorded." : "HitPay rejected the notice.");
}
