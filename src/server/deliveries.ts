import { addDays, daysBetween } from "@/domain/dates";
import { nextDelivery } from "@/domain/decide";
import { sum } from "@/domain/money";
import type { DeliveryId } from "@/domain/ids";
import type { Delivery, LedgerSnapshot } from "@/domain/types";
import { customerBalances } from "@/server/dashboard";

function literal(text: string, value: string) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`, "i").test(
    text,
  );
}

export function deliveryDetail(s: LedgerSnapshot, id: string) {
  const delivery = s.deliveries.get(id as DeliveryId);
  if (!delivery) return null;
  const customer = s.customers.get(delivery.customerId);
  const balances = customerBalances(s).find(
    (row) => row.id === delivery.customerId,
  );
  if (!customer || !balances) return null;
  const invoices = [...s.invoices.values()].filter(
    (invoice) => invoice.customerId === customer.id,
  );
  const aliases = s.aliases.filter(
    (alias) => alias.customerId === customer.id && alias.confirmedByHuman,
  );
  const credits = [...s.credits.values()].filter((credit) => {
    if (
      credit.reviewFlags.includes("hitpay_payout") ||
      credit.unallocated === 0
    )
      return false;
    const allocations = [...s.allocations.values()].filter(
      (row) =>
        row.creditId === credit.id &&
        row.state !== "rejected" &&
        row.state !== "reversed",
    );
    return (
      allocations.some((allocation) =>
        invoices.some((invoice) => invoice.id === allocation.invoiceId),
      ) ||
      invoices.some((invoice) => literal(credit.rawRef, invoice.id)) ||
      aliases.some((alias) =>
        literal(`${credit.rawRef} ${credit.payerName}`, alias.alias),
      )
    );
  });
  const request = delivery.paymentRequestId
    ? s.paymentRequests.get(delivery.paymentRequestId)
    : undefined;
  const receipts = request
    ? s.receipts.filter(
        (receipt) => receipt.hitpayRequestId === request.hitpayRequestId,
      )
    : [];
  const receipt = receipts.at(-1);
  const heldHere =
    customer.hold.status !== "normal" &&
    customer.hold.deliveryId === delivery.id;
  const next = nextDelivery(s, customer.id);
  const audit = s.audit.filter((event) => {
    const evidence = event.evidence;
    return (
      event.entityId === delivery.id ||
      event.entityId === request?.id ||
      (event.evidence.kind === "threshold" &&
        event.evidence.deliveryId === delivery.id) ||
      (event.entityId === customer.id &&
        event.after &&
        typeof event.after === "object" &&
        "deliveryId" in event.after &&
        event.after.deliveryId === delivery.id) ||
      (evidence.kind === "webhook" &&
        receipts.some((row) => row.id === evidence.receiptId))
    );
  });
  const exception = s.audit
    .filter(
      (event) =>
        event.entityId === delivery.id &&
        ["reject_hold", "override_hold"].includes(event.action),
    )
    .at(-1);
  const proposal = audit
    .filter((event) => event.action === "propose_hold")
    .at(-1);
  const paymentLabel = !request
    ? "No payment requested"
    : request.status === "creating"
      ? "Checkout creation unresolved"
      : request.status === "completed"
        ? "Verified payment recorded"
        : delivery.status === "on_credit" && exception
          ? "Earlier pay-first request pending · credit exception recorded"
          : receipt && !["applied", "not_completed"].includes(receipt.outcome)
            ? "Payment verification needs review"
            : "Awaiting verified payment";
  const statusLabel =
    delivery.status === "released"
      ? request?.status === "completed"
        ? "Released after verified payment"
        : "Released on credit"
      : delivery.status === "pay_first"
        ? "Pay-first approved"
        : delivery.status === "proposed_pay_first"
          ? "Pay-first proposed"
          : delivery.status === "cancelled"
            ? "Cancelled"
            : exception
              ? "On credit · human exception"
              : "On credit";
  const canEvaluate =
    delivery.status === "on_credit" &&
    !delivery.creditDecisionBy &&
    customer.hold.status === "normal" &&
    next?.id === delivery.id;
  const nextAction =
    delivery.status === "released"
      ? "View audit"
      : delivery.status === "cancelled"
        ? "View details"
        : request?.status === "creating"
          ? "Inspect unresolved request"
          : delivery.status === "pay_first"
            ? "Open checkout / check payment"
            : delivery.status === "proposed_pay_first"
              ? "Review proposal"
              : exception
                ? "Review recorded exception"
                : canEvaluate
                  ? "Evaluate delivery"
                  : next && next.id !== delivery.id
                    ? `Review ${next.id} first`
                    : "Review delivery details";
  let explanation =
    "On credit is the current delivery state; it is not a claim that payment has been received or that the customer is risk-free.";
  if (delivery.status === "proposed_pay_first")
    explanation =
      "Tally proposed pay-first. A human must review and approve before collection is required.";
  else if (delivery.status === "pay_first")
    explanation =
      "The owner approved payment for this delivery first. Its exact verified payment can release this delivery; old invoices remain separate.";
  else if (delivery.status === "released")
    explanation =
      request?.status === "completed"
        ? "Verified payment for this delivery released it. Older invoice balances remain separately outstanding."
        : "This delivery was explicitly released on credit; this does not imply its invoices were paid.";
  else if (exception)
    explanation = `Human exception recorded: “${exception.evidence.kind === "human_reason" ? exception.evidence.reason : "see Audit"}” This delivery will not be proposed again.`;
  else if (canEvaluate)
    explanation +=
      balances.overdue > s.settings.overdueBalanceThreshold
        ? " Current eligible overdue balance exceeds the threshold; evaluation can propose pay-first."
        : " Current eligible overdue balance does not exceed the threshold.";
  const lastImport =
    s.audit
      .filter(
        (event) =>
          event.action === "imported" && event.evidence.kind === "csv_row",
      )
      .at(-1)?.at ?? null;
  return {
    delivery,
    customer,
    balances,
    invoices: invoices.map((invoice) => ({
      ...invoice,
      daysPastDue: invoice.dueOn ? daysBetween(invoice.dueOn, s.today) : null,
    })),
    credits,
    reviewAmount: sum(credits.map((credit) => credit.unallocated)),
    request,
    paymentLabel,
    statusLabel,
    nextAction,
    explanation,
    canEvaluate,
    heldHere,
    nextDeliveryId: next?.id ?? null,
    audit,
    proposal,
    lastImport,
    exception,
  };
}

export type DeliveryDetail = NonNullable<ReturnType<typeof deliveryDetail>>;
export type DeliveryFilter = "today" | "tomorrow" | "upcoming";
export function deliveryList(
  s: LedgerSnapshot,
  filter: DeliveryFilter = "upcoming",
) {
  const tomorrow = addDays(s.today, 1);
  return [...s.deliveries.values()]
    .filter((delivery: Delivery) =>
      filter === "today"
        ? delivery.scheduledFor === s.today
        : filter === "tomorrow"
          ? delivery.scheduledFor === tomorrow
          : delivery.scheduledFor >= s.today,
    )
    .sort(
      (a, b) =>
        a.scheduledFor.localeCompare(b.scheduledFor) ||
        a.id.localeCompare(b.id),
    )
    .map((delivery) => deliveryDetail(s, delivery.id)!)
    .filter(Boolean);
}
