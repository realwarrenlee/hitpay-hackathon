import { formatSgd } from "@/domain/money";
import { creditState } from "@/domain/balances";
import { overdueBalance } from "@/domain/balances";
import type { Invoice, LedgerSnapshot } from "@/domain/types";

export function invoiceLabel(status: Invoice["status"]): string {
  if (status === "partially_paid") return "Partially paid";
  if (status === "paid") return "Paid";
  return "Open";
}

export function holdLabel(status: "normal" | "proposed" | "pay_first"): string {
  if (status === "pay_first") return "Hold: pay-first";
  if (status === "proposed") return "Hold: proposed";
  return "Hold: normal";
}

export interface ReviewHint {
  fromModel: boolean;
  explanation: string | null;
  proposedCustomer: string | null;
  proposedInvoices: readonly string[];
}

function aiLine(hint: ReviewHint | undefined, rule: string | null): string | null {
  if (!hint?.fromModel) return null;
  if (rule !== "R3" && rule !== "R4" && rule !== "R5") return null;
  if (hint.explanation) return hint.explanation;
  const who = [hint.proposedCustomer, hint.proposedInvoices.length ? hint.proposedInvoices.join(", ") : null].filter((part): part is string => Boolean(part));
  if (who.length === 0) return null;
  return `Likely ${who.join(" · ")}.`;
}

export function reviewModel(s: LedgerSnapshot, hints: ReadonlyMap<string, ReviewHint> = new Map()) {
  const cards = [...s.credits.values()]
    .filter((credit) => {
      if (credit.source.kind === "bank_csv") return true;
      return [...s.allocations.values()].some((row) => row.creditId === credit.id && row.state === "suggested");
    })
    .sort((a, b) => {
      const aLine = a.source.kind === "bank_csv" ? a.source.fileLine : 100000;
      const bLine = b.source.kind === "bank_csv" ? b.source.fileLine : 100000;
      return aLine - bLine || a.rawRef.localeCompare(b.rawRef);
    })
    .map((credit) => {
      const fileLine = credit.source.kind === "bank_csv" ? credit.source.fileLine : 0;
      const suggestion = [...s.suggestions.values()].find((row) => row.creditId === credit.id && row.status !== "rejected");
      const allocations = [...s.allocations.values()].filter((row) => row.creditId === credit.id);
      const state = creditState(allocations);
      const shortfall = suggestion?.body.kind === "single" && suggestion.body.rule !== "R1" ? suggestion.body.shortfall : null;
      const rule = suggestion?.body.rule ?? null;
      return {
        creditId: credit.id,
        valueDate: credit.valueDate,
        amountLabel: formatSgd(credit.amount),
        rawRef: credit.rawRef,
        payerName: credit.payerName,
        fileLine,
        name: credit.source.kind === "bank_csv" ? `Credit line ${fileLine}` : `HitPay ${credit.rawRef}`,
        state: state === "suggested" ? "Suggested" : state === "approved" ? "Approved" : state === "reconciled" ? "Reconciled" : "Unmatched",
        rule,
        tier: suggestion?.body.tier ?? null,
        reason:
          suggestion?.body.reason ??
          (s.audit.find((event) => event.entityId === credit.id && event.action === "unmatched")?.after as { reason?: string } | null)?.reason ??
          (state === "unmatched" ? unmatchedReason(credit.amount) : ""),
        ai: aiLine(hints.get(credit.id), rule),
        shortfallLabel: shortfall ? `possible short payment ${formatSgd(shortfall)}` : null,
        preselected: suggestion?.body.preselected ?? false,
        suggestionId: suggestion?.id ?? null,
        kind: suggestion?.body.kind ?? null,
        candidates: suggestion?.body.kind === "choose_one" ? [...suggestion.body.candidates] : [],
        undoId: allocations.find((row) => row.state === "approved")?.id ?? null,
        committed: allocations.some((row) => row.state === "reconciled"),
      };
    });
  const invoices = [...s.invoices.values()].map((inv) => {
    const requests = [...s.paymentRequests.values()].filter((row) => row.purpose.kind === "remainder" && row.purpose.invoiceId === inv.id);
    const pending = requests.find((row) => row.status === "pending");
    return {
      id: inv.id,
      name: `Invoice ${inv.id}`,
      status: invoiceLabel(inv.status),
      remainingLabel: `${formatSgd(inv.remaining)} remaining`,
      requestLabel: `Request ${formatSgd(inv.remaining)}`,
      requestUrl: requests.find((row) => row.url)?.url ?? null,
      pendingRequestId: pending?.id ?? null,
    };
  });
  return { cards, invoices };
}

function unmatchedReason(amount: Parameters<typeof formatSgd>[0]) {
  return `no open invoice for ${formatSgd(amount)} within 60 days`;
}

export function customerModel(s: LedgerSnapshot, customerId: string) {
  const customer = s.customers.get(customerId as never);
  if (!customer) return null;
  const invoices = [...s.invoices.values()].filter((inv) => inv.customerId === customer.id);
  const overdue = overdueBalance(
    invoices.map((invoice) => ({ invoice, balance: { allocated: invoice.allocated, writtenOff: invoice.writtenOff, remaining: invoice.remaining, status: invoice.status } })),
    s.settings,
    s.today,
  );
  const delivery = [...s.deliveries.values()].find((row) => row.customerId === customer.id);
  const payFirst = [...s.paymentRequests.values()].find((row) => row.purpose.kind === "pay_first" && delivery && row.purpose.deliveryId === delivery.id);
  return {
    id: customer.id,
    name: customer.name,
    hold: holdLabel(customer.hold.status),
    overdue: formatSgd(overdue),
    threshold: formatSgd(s.settings.overdueBalanceThreshold),
    deliveryId: delivery?.id ?? null,
    deliveryAmount: delivery ? formatSgd(delivery.amount) : null,
    deliveryStatus: delivery?.status ?? null,
    payUrl: payFirst?.url ?? null,
    audit: s.audit.filter((event) => event.entityId === customer.id || event.evidence.kind === "csv_row" || event.entity === "allocation"),
  };
}

export function driverModel(s: LedgerSnapshot, deliveryId: string) {
  const delivery = s.deliveries.get(deliveryId as never);
  if (!delivery) return null;
  const request = delivery.paymentRequestId ? s.paymentRequests.get(delivery.paymentRequestId) : [...s.paymentRequests.values()].find((row) => row.purpose.kind === "pay_first" && row.purpose.deliveryId === delivery.id);
  const label = delivery.status === "released" ? "Released" : delivery.status === "pay_first" ? `Pay first: ${formatSgd(delivery.amount)}` : "On credit";
  return {
    id: delivery.id,
    heading: `Delivery ${delivery.id}`,
    label,
    url: request?.url ?? null,
    status: delivery.status,
    paymentRequestId: request?.status === "pending" ? request.id : null,
    requestStatus: request?.status ?? null,
  };
}
