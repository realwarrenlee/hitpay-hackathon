import type { AuditEvent } from "@/domain/types";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Singapore",
});
const timeFormat = new Intl.DateTimeFormat("en-SG", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Singapore",
});
export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : dateFormat.format(date);
}
export function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : timeFormat.format(date);
}
export function plural(
  count: number,
  singular: string,
  multiple = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : multiple}`;
}
export function displayReason(reason: string): string {
  return reason
    .replaceAll(" -> ", " → ")
    .replace(
      /possible short payment\.?/gi,
      "partial payment; the remaining balance is still unpaid.",
    )
    .replace(
      "Exact amount, pre-ticked.",
      "Exact reference and amount. Human approval is required.",
    )
    .replace("None pre-ticked.", "Choose an invoice before approving.")
    .replace(/Ref "([^"]+)" → (INV-\d+) \(open, S\$[\d,.]+\)\./, 'Reference "$1" matches $2.')
    .replace(/No other combination of .+?'s open invoices sums to S\$[\d,.]+\./, "No alternative invoice combination.")
    .replace(/(?:^| )Amount is S\$[\d,.]+ below the balance → partial payment; the remaining balance is still unpaid\./, " Partial payment; reason for the shortfall is unknown.")
    .replace(/^INV-\d+ is open for S\$[\d,.]+\. /, "")
    .trim();
}
export function newestActivity(events: readonly AuditEvent[]): AuditEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const delta = Date.parse(b.event.at) - Date.parse(a.event.at);
      return Number.isFinite(delta) && delta !== 0
        ? delta
        : b.event.id.localeCompare(a.event.id, "en", { numeric: true }) ||
            b.index - a.index;
    })
    .map(({ event }) => event);
}
const activityNames: Record<string, string> = {
  policy_updated: "Overdue policy updated",
  seeded: "Workspace initialized",
  mcp_created: "Payment link created",
  hint_recorded: "Reference hint recorded",
  webhook_confirmed: "Payment confirmed",
  delivery_evaluated: "Delivery evaluated",
  propose_hold: "Pay-first proposed",
  approve_hold: "Hold approved",
  reject_hold: "Credit exception recorded",
  override_hold: "Hold overridden",
  invoice_created: "Invoice created",
  delivery_created: "Delivery scheduled",
  suggest: "Allocation suggested",
  approve: "Allocation approved",
  commit: "Allocation reconciled",
  undo: "Allocation approval undone",
  reject: "Allocation suggestion rejected",
  imported: "Credit imported",
  write_off: "Invoice amount written off",
  reverse: "Allocation reversed",
  webhook_rejected: "Payment confirmation rejected",
  create: "Payment request created",
  check_cutoff: "Delivery policy checked",
  system: "System",
  ai: "AI",
};
export function actionLabel(action: string): string {
  return (
    activityNames[action] ??
    action.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
  );
}
export function activityReason(event: AuditEvent): string | null {
  if (event.evidence.kind !== "human_reason") return null;
  const reason = event.evidence.reason.trim();
  if (
    !reason ||
    [
      "rejected", "undo", "confirmed", "approve hold", "marked delivered",
      "Explicit delivery policy evaluation",
      "Supplier entered invoice with agreed due date",
      "Supplier scheduled delivery; policy evaluation is a separate action",
      "Unauthenticated loopback development update; future evaluations only",
    ].includes(reason) ||
    (event.action === "commit" && reason === `Commit approved by ${event.actor.kind === "human" ? event.actor.name : ""}`)
  ) return null;
  return reason === "demo world" ? "Fictional opening records" : reason;
}
