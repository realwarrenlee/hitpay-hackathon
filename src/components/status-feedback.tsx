const messages: Record<string, string> = {
  selection_required: "Select the allocations you intend to approve or reconcile. Nothing was changed.",
  access_denied: "Supplier actions require the explicitly enabled local loopback demo. Production and network writes are disabled.",
  invalid_input: "Check the fields and try again. Nothing was changed.",
  duplicate: "This reference already exists with different details. Use a unique reference.",
  identity_mismatch: "Payment identity did not match the stored request. No payment was applied; check again after resolving the provider data.",
  currency_mismatch: "Payment currency could not be verified as SGD. No payment was applied.",
  purpose_mismatch: "Payment purpose did not match this obligation. No payment was applied.",
  obligation_mismatch: "The stored payment request no longer matches this delivery. Review the ledger before collecting again.",
  event_mismatch: "This notification does not confirm a completed payment request. No payment was applied.",
  amount_mismatch: "Payment amounts did not match. No automatic allocation or delivery release occurred; review the request and payment evidence.",
  request_unresolved: "Checkout creation is unresolved. Do not retry payment creation. Inspect the provider using the existing payment reference; the ledger and hold have been preserved.",
  no_header:
    "The DBS CSV header could not be found. Use the original DBS export.",
  bad_date:
    "A transaction date could not be read. Check the date in your DBS export.",
  bad_amount:
    "A credit amount could not be read. Check the amount in your DBS export.",
  empty: "This file contains no bank transactions.",
  not_found:
    "This record is no longer available. Refresh the page and try again.",
  illegal_transition:
    "This action is unavailable for the current status. Refresh to see the latest details.",
  below_minimum: "The remaining amount is below the minimum payment request.",
  tool_error: "The payment service is unavailable. Please try again.",
  transport: "The payment service is unavailable. Please try again.",
};
export function StatusFeedback({ status }: { status?: string }) {
  if (!status) return null;
  const code = status.split(" ")[0];
  const error = messages[code];
  const line = status.match(/on line (\d+)/)?.[1];
  return (
    <div
      role={error ? "alert" : "status"}
      className={`rounded-lg border bg-card p-4 text-sm leading-6 ${error ? "border-red-500/30 text-red-700 dark:text-red-400" : ""}`}
    >
      {error ?? status}
      {error && line ? ` Line ${line}.` : ""}
    </div>
  );
}
