import { nextDelivery } from "@/domain/decide";
import { cents, formatSgd, sum } from "@/domain/money";
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

function aiLine(
  hint: ReviewHint | undefined,
  rule: string | null,
): string | null {
  if (!hint?.fromModel) return null;
  if (rule !== "R3" && rule !== "R4" && rule !== "R5") return null;
  if (hint.explanation) return hint.explanation;
  const who = [
    hint.proposedCustomer,
    hint.proposedInvoices.length ? hint.proposedInvoices.join(", ") : null,
  ].filter((part): part is string => Boolean(part));
  if (who.length === 0) return null;
  return `Likely ${who.join(" · ")}.`;
}

export function reviewModel(
  s: LedgerSnapshot,
  hints: ReadonlyMap<string, ReviewHint> = new Map(),
) {
  const cards = [...s.credits.values()]
    .filter((credit) => {
      if (credit.source.kind === "bank_csv" || credit.unallocated > 0)
        return true;
      return [...s.allocations.values()].some(
        (row) => row.creditId === credit.id && row.state === "suggested",
      );
    })
    .sort((a, b) => {
      const aLine = a.source.kind === "bank_csv" ? a.source.fileLine : 100000;
      const bLine = b.source.kind === "bank_csv" ? b.source.fileLine : 100000;
      return aLine - bLine || a.rawRef.localeCompare(b.rawRef);
    })
    .map((credit) => {
      const fileLine =
        credit.source.kind === "bank_csv" ? credit.source.fileLine : 0;
      const suggestion = [...s.suggestions.values()].find(
        (row) => row.creditId === credit.id && row.status !== "rejected",
      );
      const allocations = [...s.allocations.values()].filter(
        (row) => row.creditId === credit.id,
      );
      const state = creditState(allocations);
      const shortfall =
        suggestion?.body.kind === "single" && suggestion.body.rule !== "R1"
          ? suggestion.body.shortfall
          : null;
      const rule = suggestion?.body.rule ?? null;
      const body = suggestion?.body;
      const accepted =
        suggestion?.status === "accepted"
          ? allocations.filter(
              (allocation) =>
                allocation.state === "approved" ||
                allocation.state === "reconciled",
            )
          : null;
      const parts = accepted
        ? accepted.map(({ invoiceId, amount }) => ({ invoiceId, amount }))
        : body?.kind === "split"
          ? body.parts
          : body?.kind === "single"
            ? [{ invoiceId: body.invoiceId, amount: body.amount }]
            : body?.kind === "choose_one"
              ? body.candidates.map((invoiceId) => ({
                  invoiceId,
                  amount: body.amount,
                }))
              : [];
      const options = parts.map((part) => {
        const invoice = s.invoices.get(part.invoiceId);
        const customer = invoice
          ? s.customers.get(invoice.customerId)
          : undefined;
        return {
          invoiceId: part.invoiceId,
          customerName: customer?.name ?? "Unknown customer",
          currentRemaining: invoice?.remaining ?? null,
          amount: part.amount,
          remainingAfter:
            invoice && part.amount <= invoice.remaining
              ? cents(invoice.remaining - part.amount)
              : null,
          valid: Boolean(
            invoice &&
            part.amount > 0 &&
            part.amount <= invoice.remaining &&
            part.amount <= credit.unallocated,
          ),
        };
      });
      const valid =
        options.length > 0 &&
        options.every((option) => option.valid) &&
        (body?.kind === "choose_one" ||
          sum(options.map((option) => option.amount)) <= credit.unallocated);
      return {
        creditId: credit.id,
        amount: credit.amount,
        unallocated: credit.unallocated,
        options,
        valid,
        matchSummary: !body
          ? "No suggested allocation"
          : body.kind === "choose_one"
            ? accepted?.map((allocation) => allocation.invoiceId).join(" + ") ||
              "Choose an invoice"
            : body.kind === "split"
              ? `${body.parts.length} invoices · split allocation`
              : body.rule === "R3"
                ? `${body.invoiceId} · partial payment`
                : body.rule === "R6"
                  ? `${body.invoiceId} · excess credit`
                  : body.invoiceId,
        approvedAllocationIds: allocations
          .filter((allocation) => allocation.state === "approved")
          .map((allocation) => allocation.id),
        approvedAmount: sum(
          allocations
            .filter((allocation) => allocation.state === "approved")
            .map((allocation) => allocation.amount),
        ),
        valueDate: credit.valueDate,
        amountLabel: formatSgd(credit.amount),
        rawRef: credit.rawRef,
        payerName: credit.payerName,
        fileLine,
        name:
          credit.source.kind === "bank_csv"
            ? `Credit line ${fileLine}`
            : `HitPay ${credit.rawRef}`,
        state:
          state === "suggested"
            ? "Suggested"
            : state === "approved"
              ? "Approved"
              : state === "reconciled"
                ? "Reconciled"
                : "Unmatched",
        rule,
        tier: suggestion?.body.tier ?? null,
        reason:
          suggestion?.body.reason ??
          (
            s.audit.find(
              (event) =>
                event.entityId === credit.id && event.action === "unmatched",
            )?.after as { reason?: string } | null
          )?.reason ??
          (state === "unmatched"
            ? credit.source.kind === "bank_csv"
              ? unmatchedReason(credit.amount)
              : "Verified receipt has unallocated credit. Review the receipt and current invoice balance before allocating."
            : ""),
        ai: aiLine(hints.get(credit.id), rule),
        referenceHint: hints.get(credit.id)?.fromModel
          ? {
              customer: hints.get(credit.id)!.proposedCustomer,
              invoices: hints.get(credit.id)!.proposedInvoices,
            }
          : null,
        shortfallLabel: shortfall
          ? `possible short payment ${formatSgd(shortfall)}`
          : null,
        preselected: suggestion?.body.preselected ?? false,
        suggestionId: suggestion?.id ?? null,
        kind: suggestion?.body.kind ?? null,
        candidates:
          suggestion?.body.kind === "choose_one"
            ? [...suggestion.body.candidates]
            : [],
        undoId: allocations.find((row) => row.state === "approved")?.id ?? null,
        committed: allocations.some((row) => row.state === "reconciled"),
      };
    });
  const invoices = [...s.invoices.values()].map((inv) => {
    const requests = [...s.paymentRequests.values()].filter(
      (row) =>
        row.purpose.kind === "remainder" && row.purpose.invoiceId === inv.id,
    );
    const pending = requests.find((row) => row.status === "pending");
    return {
      id: inv.id,
      name: `Invoice ${inv.id}`,
      status: invoiceLabel(inv.status),
      remaining: inv.remaining,
      remainingLabel: `${formatSgd(inv.remaining)} remaining`,
      requestLabel: `Request ${formatSgd(inv.remaining)}`,
      requestUrl: requests.find((row) => row.url)?.url ?? null,
      pendingRequestId: pending?.id ?? null,
      unresolvedReference:
        requests.find((row) => row.status === "creating")?.referenceNumber ??
        null,
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
  const invoices = [...s.invoices.values()].filter(
    (inv) => inv.customerId === customer.id,
  );
  const overdue = overdueBalance(
    invoices.map((invoice) => ({
      invoice,
      balance: {
        allocated: invoice.allocated,
        writtenOff: invoice.writtenOff,
        remaining: invoice.remaining,
        status: invoice.status,
      },
    })),
    s.settings,
    s.today,
  );
  const delivery =
    customer.hold.status !== "normal"
      ? s.deliveries.get(customer.hold.deliveryId)
      : (nextDelivery(s, customer.id) ??
        [...s.deliveries.values()]
          .filter((row) => row.customerId === customer.id)
          .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor))[0]);
  const payFirst = [...s.paymentRequests.values()].find(
    (row) =>
      row.purpose.kind === "pay_first" &&
      delivery &&
      row.purpose.deliveryId === delivery.id,
  );
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
    unresolvedReference:
      payFirst?.status === "creating" ? payFirst.referenceNumber : null,
    unknownDueDates: invoices.filter(
      (invoice) => invoice.dueOn == null && invoice.remaining > 0,
    ).length,
    audit: s.audit.filter(
      (event) =>
        event.entityId === customer.id ||
        event.evidence.kind === "csv_row" ||
        event.entity === "allocation",
    ),
  };
}

export function driverModel(s: LedgerSnapshot, deliveryId: string) {
  const delivery = s.deliveries.get(deliveryId as never);
  if (!delivery) return null;
  const request = delivery.paymentRequestId
    ? s.paymentRequests.get(delivery.paymentRequestId)
    : [...s.paymentRequests.values()].find(
        (row) =>
          row.purpose.kind === "pay_first" &&
          row.purpose.deliveryId === delivery.id,
      );
  const label =
    delivery.status === "released"
      ? "Released"
      : delivery.status === "pay_first"
        ? `Pay first: ${formatSgd(delivery.amount)}`
        : delivery.status === "proposed_pay_first"
          ? "Pay-first proposed · owner review required"
          : delivery.status === "cancelled"
            ? "Cancelled"
            : "On credit";
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
