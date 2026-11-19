const messages: Record<string, string> = {
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
