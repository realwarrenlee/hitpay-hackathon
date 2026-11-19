import { cents, type Cents } from "@/domain/money";
import type {
  AllocationId,
  CreditId,
  CustomerId,
  Instant,
  InvoiceId,
  PaymentRequestId,
  SuggestionId,
} from "@/domain/ids";
import { invoiceBalance, overdueBalance, referenceNumber, signedRemaining, signedUnallocated, dedupeKey } from "@/domain/balances";
import { evaluateCutOff } from "@/domain/cutoff";
import { validPolicy } from "@/domain/policy";
import type {
  Allocation,
  AuditEvent,
  BankCredit,
  Change,
  Command,
  ConfirmedPayment,
  Customer,
  Delivery,
  Evidence,
  HumanActor,
  LedgerSnapshot,
  Rejection,
  StoredSuggestion,
  SuggestionBody,
  SystemActor,
} from "@/domain/types";
import type { Result } from "@/domain/money";

function nid(s: LedgerSnapshot, prefix: string): string {
  const id = `${prefix}-${String(s.seq).padStart(4, "0")}`;
  s.seq += 1;
  return id;
}

function makeAudit(
  s: LedgerSnapshot,
  at: Instant,
  actor: AuditEvent["actor"],
  entity: string,
  entityId: string,
  action: string,
  before: unknown,
  after: unknown,
  evidence: Evidence,
): AuditEvent {
  return { id: nid(s, "AUD"), at, actor, entity, entityId, action, before, after, evidence };
}

function rej(code: Rejection["code"], detail: string): Rejection {
  return { code, detail };
}

function allocationsFor(s: LedgerSnapshot, suggestionId: SuggestionId): Allocation[] {
  return [...s.allocations.values()].filter((row) => row.suggestionId === suggestionId);
}

function customerOfInvoice(s: LedgerSnapshot, invoiceId: InvoiceId): CustomerId | null {
  return s.invoices.get(invoiceId)?.customerId ?? null;
}

function queueCutoff(followUps: Command[], customerId: CustomerId) {
  if (followUps.some((cmd) => cmd.kind === "check_cutoff" && cmd.customerId === customerId)) return;
  followUps.push({ kind: "check_cutoff", customerId, by: { kind: "system" } });
}

function canTake(s: LedgerSnapshot, creditId: CreditId, invoiceId: InvoiceId, amount: Cents): Rejection | null {
  const credit = s.credits.get(creditId);
  if (!credit) return rej("not_found", String(creditId));
  const used = [...s.allocations.values()]
    .filter((row) => row.creditId === creditId && (row.state === "approved" || row.state === "reconciled"))
    .reduce((total, row) => total + (row.amount as number), 0);
  if (used + (amount as number) > (credit.amount as number)) return rej("over_allocation", String(creditId));
  const inv = s.invoices.get(invoiceId);
  if (!inv) return rej("not_found", String(invoiceId));
  if ((amount as number) > (inv.remaining as number)) return rej("negative_balance", String(invoiceId));
  return null;
}

function recompute(s: LedgerSnapshot): Rejection | null {
  const allocs = [...s.allocations.values()];
  for (const inv of s.invoices.values()) {
    if (signedRemaining(inv, allocs, s.writeOffs) < 0) return rej("negative_balance", String(inv.id));
    const balance = invoiceBalance(inv, allocs, s.writeOffs);
    inv.allocated = balance.allocated;
    inv.writtenOff = balance.writtenOff;
    inv.remaining = balance.remaining;
    inv.status = balance.status;
  }
  for (const credit of s.credits.values()) {
    if (signedUnallocated(credit, allocs) < 0) return rej("over_allocation", String(credit.id));
    credit.unallocated = cents(signedUnallocated(credit, allocs));
  }
  return null;
}

function csvEvidence(s: LedgerSnapshot, credit: BankCredit): Evidence {
  const source = credit.source;
  if (source.kind === "bank_csv") {
    return { kind: "csv_row", batchId: source.batchId, fileLine: source.fileLine };
  }
  const receipt = s.receipts.find((row) => row.id === source.receiptId);
  return { kind: "webhook", receiptId: source.receiptId, hitpayRequestId: receipt?.hitpayRequestId ?? null, source: receipt?.source ?? "webhook" };
}

function settlementEvidence(event: Pick<ConfirmedPayment, "receiptId" | "hitpayRequestId" | "source">): Evidence {
  return { kind: "webhook", receiptId: event.receiptId, hitpayRequestId: event.hitpayRequestId, source: event.source };
}

function addSuggestion(s: LedgerSnapshot, credit: BankCredit, body: SuggestionBody, now: Instant, audits: AuditEvent[], actor: AuditEvent["actor"], evidenceOverride?: Evidence): StoredSuggestion {
  const id = nid(s, "SUG") as SuggestionId;
  const stored: StoredSuggestion = { id, creditId: credit.id, status: "open", body };
  s.suggestions.set(id, stored);
  const parts = body.kind === "split" ? body.parts : body.kind === "choose_one" ? body.candidates.map((invoiceId) => ({ invoiceId, amount: body.amount })) : [{ invoiceId: body.invoiceId, amount: body.amount }];
  for (const part of parts) {
    const allocation: Allocation = {
      id: nid(s, "ALC") as AllocationId,
      suggestionId: id,
      creditId: credit.id,
      invoiceId: part.invoiceId,
      amount: part.amount,
      state: "suggested",
      tier: body.tier,
      rule: body.rule,
      reason: body.reason,
      approvedBy: null,
      approvedAt: null,
      reconciledAt: null,
      rejectedBy: null,
      rejectedAt: null,
      reversedBy: null,
      reversedReason: null,
      reversedAt: null,
    };
    s.allocations.set(allocation.id, allocation);
    audits.push(makeAudit(s, now, actor, "allocation", allocation.id, "suggest", null, { state: "suggested", amount: part.amount, invoiceId: part.invoiceId }, evidenceOverride ?? csvEvidence(s, credit)));
  }
  if (body.kind === "single" && body.rule !== "R1" && body.unallocated && !credit.reviewFlags.includes("overpayment_unallocated")) {
    credit.reviewFlags = [...credit.reviewFlags, "overpayment_unallocated"];
  }
  return stored;
}

function approveAllocation(s: LedgerSnapshot, allocation: Allocation, by: Allocation["approvedBy"], now: Instant, audits: AuditEvent[], evidence: Evidence) {
  const before = allocation.state;
  allocation.state = "approved";
  allocation.approvedBy = by;
  allocation.approvedAt = now;
  audits.push(makeAudit(s, now, by?.kind === "human" ? by : { kind: "system" }, "allocation", allocation.id, "approve", { state: before }, { state: "approved", approvedBy: by }, evidence));
}

function commitAllocation(s: LedgerSnapshot, allocation: Allocation, now: Instant, audits: AuditEvent[], evidence: Evidence) {
  const before = allocation.state;
  allocation.state = "reconciled";
  allocation.reconciledAt = now;
  audits.push(makeAudit(s, now, { kind: "system" }, "allocation", allocation.id, "commit", { state: before }, { state: "reconciled" }, evidence));
}

function apply(s: LedgerSnapshot, cmd: Command, now: Instant, audits: AuditEvent[], followUps: Command[], info: Record<string, string | number>): Rejection | null {
  switch (cmd.kind) {
    case "update_policy": {
      if (cmd.by.kind !== "human" || cmd.by.access !== "loopback_development" || !cmd.by.name.trim()) return rej("wrong_actor", "Local development operator required");
      if (!validPolicy(cmd.values) || !Number.isSafeInteger(cmd.expectedVersion) || cmd.expectedVersion < 0 || cmd.expectedVersion >= Number.MAX_SAFE_INTEGER) return rej("invalid_policy", "Invalid overdue policy");
      if (cmd.expectedVersion !== s.policyVersion) return rej("policy_conflict", "The policy changed. Reload the latest configuration before saving.");
      if (cmd.values.overdueBalanceThreshold === s.settings.overdueBalanceThreshold && cmd.values.overdueDaysThreshold === s.settings.overdueDaysThreshold) return null;
      const before = { ...s.settings, version: s.policyVersion };
      s.settings = { ...cmd.values };
      s.policyVersion += 1;
      audits.push(makeAudit(s, now, cmd.by, "settings", "settings", "policy_updated", before, { ...s.settings, version: s.policyVersion }, { kind: "human_reason", reason: "Unauthenticated loopback development update; future evaluations only" }));
      return null;
    }
    case "import_batch": {
      const groups = new Map<string, typeof cmd.batch.rows>();
      for (const row of cmd.batch.rows) {
        if (row.bankTxnId) continue;
        const key = `${row.valueDate}|${row.amount as number}|${row.rawRef}`;
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      const identical = new Set<(typeof cmd.batch.rows)[number]>();
      for (const rows of groups.values()) if (rows.length >= 2) rows.forEach((row) => identical.add(row));
      const seen = new Set([...s.credits.values()].map((credit) => credit.dedupeKey));
      let inserted = 0;
      let already = 0;
      let review = 0;
      for (const row of cmd.batch.rows) {
        const flags = [...row.reviewFlags];
        if (identical.has(row) && !flags.includes("identical_row")) flags.push("identical_row");
        if (flags.length > 0) review += 1;
        const key = dedupeKey(row, cmd.batch.batchId, cmd.batch.bank);
        if (seen.has(key)) {
          already += 1;
          continue;
        }
        const credit: BankCredit = {
          id: nid(s, "CR") as CreditId,
          source: { kind: "bank_csv", bank: cmd.batch.bank, batchId: cmd.batch.batchId, fileLine: row.fileLine, bankTxnId: row.bankTxnId },
          dedupeKey: key,
          valueDate: row.valueDate,
          amount: row.amount,
          rawRef: row.rawRef,
          payerName: row.payerName,
          reviewFlags: flags,
          unallocated: row.amount,
        };
        s.credits.set(credit.id, credit);
        seen.add(key);
        inserted += 1;
        audits.push(makeAudit(s, now, cmd.actor, "bank_credit", credit.id, "imported", null, { amount: row.amount, fileLine: row.fileLine }, { kind: "csv_row", batchId: cmd.batch.batchId, fileLine: row.fileLine }));
      }
      info.inserted = inserted;
      info.already = already;
      info.review = review;
      return null;
    }
    case "record_suggestions": {
      const credit = s.credits.get(cmd.creditId);
      if (!credit) return rej("not_found", String(cmd.creditId));
      if (credit.reviewFlags.includes("hitpay_payout")) return null;
      if ([...s.suggestions.values()].some((row) => row.creditId === credit.id)) return null;
      if (cmd.result.kind === "unmatched") {
        audits.push(makeAudit(s, now, { kind: "system" }, "bank_credit", credit.id, "unmatched", null, { reason: cmd.result.reason }, csvEvidence(s, credit)));
        return null;
      }
      addSuggestion(s, credit, cmd.result.suggestion, now, audits, { kind: "system" });
      return null;
    }
    case "record_hint": {
      const credit = s.credits.get(cmd.creditId);
      if (!credit) return rej("not_found", String(cmd.creditId));
      audits.push(makeAudit(s, now, { kind: "ai" }, "bank_credit", credit.id, "hint_recorded", null, cmd.hints, { kind: "hint", rawRef: credit.rawRef }));
      return null;
    }
    case "approve":
      return approveSuggestion(s, cmd.suggestionId, cmd.pick, cmd.by, now, audits, followUps);
    case "approve_preselected": {
      const open = [...s.suggestions.values()].filter((row) => row.status === "open" && row.body.preselected);
      for (const suggestion of open) {
        const error = approveSuggestion(s, suggestion.id, null, cmd.by, now, audits, followUps);
        if (error) return error;
      }
      return null;
    }
    case "reject": {
      const suggestion = s.suggestions.get(cmd.suggestionId);
      if (!suggestion || suggestion.status !== "open") return rej("not_found", String(cmd.suggestionId));
      for (const allocation of allocationsFor(s, suggestion.id)) {
        if (allocation.state !== "suggested") return rej("illegal_transition", allocation.state);
        allocation.state = "rejected";
        allocation.rejectedBy = cmd.by;
        allocation.rejectedAt = now;
        audits.push(makeAudit(s, now, cmd.by, "allocation", allocation.id, "reject", { state: "suggested" }, { state: "rejected" }, { kind: "human_reason", reason: "rejected" }));
      }
      suggestion.status = "rejected";
      return null;
    }
    case "manual_allocate": {
      const credit = s.credits.get(cmd.creditId);
      if (!credit) return rej("not_found", String(cmd.creditId));
      const error = canTake(s, cmd.creditId, cmd.invoiceId, cmd.amount);
      if (error) return error;
      const body: SuggestionBody = {
        kind: "single",
        rule: "R6",
        tier: "C",
        invoiceId: cmd.invoiceId,
        amount: cmd.amount,
        preselected: false,
        shortfall: null,
        unallocated: null,
        reason: "Manual allocation",
      };
      const suggestion = addSuggestion(s, credit, body, now, audits, cmd.by);
      return approveSuggestion(s, suggestion.id, null, cmd.by, now, audits, followUps);
    }
    case "undo": {
      const allocation = s.allocations.get(cmd.allocationId);
      if (!allocation) return rej("not_found", String(cmd.allocationId));
      if (allocation.state !== "approved") return rej("illegal_transition", allocation.state);
      allocation.state = "suggested";
      allocation.approvedBy = null;
      allocation.approvedAt = null;
      const suggestion = s.suggestions.get(allocation.suggestionId);
      if (suggestion) suggestion.status = "open";
      audits.push(makeAudit(s, now, cmd.by, "allocation", allocation.id, "undo", { state: "approved" }, { state: "suggested" }, { kind: "human_reason", reason: "undo" }));
      const customerId = customerOfInvoice(s, allocation.invoiceId);
      if (customerId) queueCutoff(followUps, customerId);
      return null;
    }
    case "commit_approved": {
      for (const allocation of s.allocations.values()) {
        if (allocation.state !== "approved") continue;
        commitAllocation(s, allocation, now, audits, { kind: "human_reason", reason: `Commit approved by ${cmd.by.name}` });
      }
      return null;
    }
    case "reverse": {
      if (cmd.by.kind !== "human" || cmd.reason.trim() === "") return rej("wrong_actor", "reverse needs a human and a reason");
      const allocation = s.allocations.get(cmd.allocationId);
      if (!allocation) return rej("not_found", String(cmd.allocationId));
      if (allocation.state !== "reconciled") return rej("illegal_transition", allocation.state);
      allocation.state = "reversed";
      allocation.reversedBy = cmd.by;
      allocation.reversedReason = cmd.reason;
      allocation.reversedAt = now;
      audits.push(makeAudit(s, now, cmd.by, "allocation", allocation.id, "reverse", { state: "reconciled" }, { state: "reversed" }, { kind: "human_reason", reason: cmd.reason }));
      const customerId = customerOfInvoice(s, allocation.invoiceId);
      if (customerId) queueCutoff(followUps, customerId);
      return null;
    }
    case "write_off": {
      if (cmd.by.kind !== "human" || cmd.reason.trim() === "") return rej("wrong_actor", "write-off needs a human and a reason");
      const inv = s.invoices.get(cmd.invoiceId);
      if (!inv) return rej("not_found", String(cmd.invoiceId));
      if ((cmd.amount as number) <= 0 || (cmd.amount as number) > (inv.remaining as number)) return rej("negative_balance", String(cmd.invoiceId));
      s.writeOffs.push({ id: nid(s, "WOF"), invoiceId: cmd.invoiceId, amount: cmd.amount, by: cmd.by, reason: cmd.reason.trim(), at: now });
      audits.push(makeAudit(s, now, cmd.by, "invoice", cmd.invoiceId, "write_off", { writtenOff: inv.writtenOff }, { amount: cmd.amount }, { kind: "human_reason", reason: cmd.reason.trim() }));
      queueCutoff(followUps, inv.customerId);
      return null;
    }
    case "confirm_alias": {
      const customer = s.customers.get(cmd.customerId);
      if (!customer) return rej("not_found", String(cmd.customerId));
      const existing = s.aliases.find((row) => row.alias.toLowerCase() === cmd.alias.toLowerCase());
      if (existing) existing.confirmedByHuman = true;
      else s.aliases.push({ customerId: cmd.customerId, alias: cmd.alias, confirmedByHuman: true });
      audits.push(makeAudit(s, now, cmd.by, "alias", cmd.alias, "confirm_alias", null, { customerId: cmd.customerId }, { kind: "human_reason", reason: "confirmed" }));
      return null;
    }
    case "create_payment_request":
      return createPaymentRequest(s, cmd.purpose, cmd.by, now, audits, info);
    case "payment_request_created": {
      const request = s.paymentRequests.get(cmd.id);
      if (!request) return rej("not_found", String(cmd.id));
      if (request.status !== "creating") return rej("illegal_transition", request.status);
      request.status = "pending";
      request.hitpayRequestId = cmd.hitpayRequestId;
      request.url = cmd.url;
      audits.push(makeAudit(s, now, { kind: "system" }, "payment_request", request.id, "mcp_created", { status: "creating" }, { status: "pending", url: cmd.url }, { kind: "human_reason", reason: request.referenceNumber }));
      return null;
    }
    case "webhook_confirmed":
      return confirmWebhook(s, cmd, now, audits, followUps, info);
    case "webhook_rejected": {
      audits.push(makeAudit(s, now, { kind: "system" }, "webhook", cmd.receiptId, "webhook_rejected", null, { why: cmd.why }, { kind: "webhook", receiptId: cmd.receiptId, hitpayRequestId: null, source: "webhook" }));
      return null;
    }
    case "check_cutoff":
      return checkCutoff(s, cmd.customerId, now, audits);
    case "approve_hold":
      return approveHold(s, cmd.customerId, cmd.by, now, audits, info);
    case "reject_hold":
      return releaseHold(s, cmd.customerId, "proposed", "reject_hold", cmd.by, cmd.reason, now, audits);
    case "override_hold":
      return releaseHold(s, cmd.customerId, "pay_first", "override_hold", cmd.by, cmd.reason, now, audits);
    case "mark_delivered": {
      const delivery = s.deliveries.get(cmd.deliveryId);
      if (!delivery) return rej("not_found", String(cmd.deliveryId));
      if (delivery.status !== "on_credit") return rej("illegal_transition", delivery.status);
      delivery.status = "released";
      audits.push(makeAudit(s, now, cmd.by, "delivery", delivery.id, "mark_delivered", { status: "on_credit" }, { status: "released" }, { kind: "human_reason", reason: "marked delivered" }));
      return null;
    }
    default:
      return rej("not_found", "command");
  }
}

function approveSuggestion(
  s: LedgerSnapshot,
  suggestionId: SuggestionId,
  pick: InvoiceId | null,
  by: HumanActor,
  now: Instant,
  audits: AuditEvent[],
  followUps: Command[],
): Rejection | null {
  const suggestion = s.suggestions.get(suggestionId);
  if (!suggestion || suggestion.status !== "open") return rej("not_found", String(suggestionId));
  const rows = allocationsFor(s, suggestionId).filter((row) => row.state === "suggested");
  if (rows.length === 0) return rej("illegal_transition", suggestion.status);
  const evidence = csvEvidence(s, s.credits.get(suggestion.creditId)!);
  if (suggestion.body.kind === "choose_one") {
    if (!pick) return rej("illegal_transition", "pick required");
    const chosen = rows.find((row) => row.invoiceId === pick);
    if (!chosen) return rej("not_found", String(pick));
    const error = canTake(s, chosen.creditId, chosen.invoiceId, chosen.amount);
    if (error) return error;
    approveAllocation(s, chosen, by, now, audits, evidence);
    for (const sibling of rows) {
      if (sibling.id === chosen.id) continue;
      sibling.state = "rejected";
      sibling.rejectedBy = { kind: "system" } satisfies SystemActor;
      sibling.rejectedAt = now;
      audits.push(makeAudit(s, now, { kind: "system" }, "allocation", sibling.id, "reject", { state: "suggested" }, { state: "rejected" }, { kind: "human_reason", reason: `picked ${pick}` }));
    }
    suggestion.status = "accepted";
    const customerId = customerOfInvoice(s, chosen.invoiceId);
    if (customerId) queueCutoff(followUps, customerId);
    return null;
  }
  if (pick) return rej("illegal_transition", "pick is only for choose_one");
  for (const row of rows) {
    const error = canTake(s, row.creditId, row.invoiceId, row.amount);
    if (error) return error;
  }
  for (const row of rows) approveAllocation(s, row, by, now, audits, evidence);
  suggestion.status = "accepted";
  const customers = new Set(rows.map((row) => customerOfInvoice(s, row.invoiceId)).filter((id): id is CustomerId => id != null));
  for (const customerId of customers) queueCutoff(followUps, customerId);
  return null;
}

function createPaymentRequest(
  s: LedgerSnapshot,
  purpose: Command & { kind: "create_payment_request" } extends never ? never : import("@/domain/types").PaymentRequestPurpose,
  by: HumanActor,
  now: Instant,
  audits: AuditEvent[],
  info: Record<string, string | number>,
): Rejection | null {
  let amount: Cents;
  if (purpose.kind === "remainder") {
    const inv = s.invoices.get(purpose.invoiceId);
    if (!inv) return rej("not_found", String(purpose.invoiceId));
    amount = inv.remaining;
    if ((amount as number) < 30) return rej("below_minimum", String(purpose.invoiceId));
    const existing = [...s.paymentRequests.values()].find(
      (row) => row.status === "pending" && row.purpose.kind === "remainder" && row.purpose.invoiceId === purpose.invoiceId && (row.amount as number) === (amount as number),
    );
    if (existing) {
      info.existing = 1;
      info.paymentRequestId = existing.id;
      info.referenceNumber = existing.referenceNumber;
      info.amount = existing.amount as number;
      return null;
    }
  } else {
    const delivery = s.deliveries.get(purpose.deliveryId);
    if (!delivery) return rej("not_found", String(purpose.deliveryId));
    amount = delivery.amount;
    if ((amount as number) < 30) return rej("below_minimum", String(purpose.deliveryId));
  }
  const prefix = purpose.kind === "remainder" ? `TALLY-${purpose.invoiceId}-` : `TALLY-${purpose.deliveryId}-`;
  const n = [...s.paymentRequests.values()].filter((row) => row.referenceNumber.startsWith(prefix)).length + 1;
  const request = {
    id: nid(s, "PRQ") as PaymentRequestId,
    purpose,
    referenceNumber: referenceNumber(purpose, n),
    amount,
    status: "creating" as const,
    hitpayRequestId: null,
    url: null,
    createdAt: now,
  };
  s.paymentRequests.set(request.id, request);
  if (purpose.kind === "pay_first") {
    const delivery = s.deliveries.get(purpose.deliveryId);
    if (delivery) delivery.paymentRequestId = request.id;
  }
  audits.push(makeAudit(s, now, by, "payment_request", request.id, "create", null, { status: "creating", amount, referenceNumber: request.referenceNumber }, { kind: "human_reason", reason: request.referenceNumber }));
  info.paymentRequestId = request.id;
  info.referenceNumber = request.referenceNumber;
  info.amount = amount as number;
  return null;
}

function confirmWebhook(s: LedgerSnapshot, cmd: Extract<Command, { kind: "webhook_confirmed" }>, now: Instant, audits: AuditEvent[], followUps: Command[], info: Record<string, string | number>): Rejection | null {
  const request = [...s.paymentRequests.values()].find((row) => row.referenceNumber === cmd.event.referenceNumber);
  if (!request) return rej("not_found", cmd.event.referenceNumber);
  const evidence = settlementEvidence(cmd.event);
  if (request.purpose.kind === "pay_first") {
    if ((cmd.event.amountPaid as number) !== (request.amount as number)) {
      audits.push(makeAudit(s, now, { kind: "system" }, "payment_request", request.id, "amount_mismatch", { amount: request.amount }, { amount: cmd.event.amountPaid, source: cmd.event.source }, evidence));
      info.outcome = "amount_mismatch";
      return null;
    }
    const delivery = s.deliveries.get(request.purpose.deliveryId);
    const customer = delivery ? s.customers.get(delivery.customerId) : undefined;
    const matches = delivery && customer && delivery.status === "pay_first" && customer.hold.status === "pay_first" && customer.hold.deliveryId === delivery.id;
    request.status = "completed";
    if (matches && delivery && customer) {
      delivery.status = "released";
      customer.hold = { status: "normal" };
      audits.push(makeAudit(s, now, { kind: "system" }, "delivery", delivery.id, "webhook_confirmed", { status: "pay_first" }, { status: "released", source: cmd.event.source }, evidence));
      audits.push(makeAudit(s, now, { kind: "system" }, "customer", customer.id, "webhook_confirmed", { status: "pay_first" }, { status: "normal", source: cmd.event.source }, evidence));
    } else {
      audits.push(makeAudit(s, now, { kind: "system" }, "payment_request", request.id, "pay_first_unexpected", null, { status: "completed", source: cmd.event.source }, evidence));
    }
    info.outcome = "applied";
    return null;
  }
  const invoice = s.invoices.get(request.purpose.kind === "remainder" ? request.purpose.invoiceId : ("" as InvoiceId));
  if (!invoice || request.purpose.kind !== "remainder") return rej("not_found", request.id);
  const key = `hitpay:${cmd.event.hitpayRequestId}` as BankCredit["dedupeKey"];
  if ([...s.credits.values()].some((credit) => credit.dedupeKey === key)) return rej("duplicate", key);
  const paid = cmd.event.amountPaid;
  const amountsMatch = (paid as number) === (request.amount as number) && (invoice.remaining as number) === (request.amount as number) && request.status === "pending";
  const credit: BankCredit = {
    id: nid(s, "CR") as CreditId,
    source: { kind: "hitpay_webhook", receiptId: cmd.event.receiptId, paymentRequestId: request.id },
    dedupeKey: key,
    valueDate: (cmd.event.paidAt.slice(0, 10) as BankCredit["valueDate"]),
    amount: paid,
    rawRef: request.referenceNumber,
    payerName: "HitPay",
    reviewFlags: [],
    unallocated: paid,
  };
  s.credits.set(credit.id, credit);
  audits.push(makeAudit(s, now, { kind: "system" }, "bank_credit", credit.id, "imported", null, { amount: paid, source: cmd.event.source }, evidence));
  const auto = amountsMatch && s.autoApproveRemainder;
  const body: SuggestionBody = auto
    ? { kind: "single", rule: "R1", tier: "A", invoiceId: invoice.id, amount: paid, preselected: true, reason: `Verified HitPay payment ${request.referenceNumber} for the open balance.` }
    : (paid as number) <= (invoice.remaining as number)
      ? {
          kind: "single",
          rule: (paid as number) === (invoice.remaining as number) ? "R2" : "R3",
          tier: "B",
          invoiceId: invoice.id,
          amount: paid,
          preselected: false,
          shortfall: (paid as number) < (invoice.remaining as number) ? cents((invoice.remaining as number) - (paid as number)) : null,
          unallocated: null,
          reason: `HitPay payment ${request.referenceNumber} needs a human.`,
        }
      : {
          kind: "single",
          rule: "R6",
          tier: "B",
          invoiceId: invoice.id,
          amount: invoice.remaining,
          preselected: false,
          shortfall: null,
          unallocated: cents((paid as number) - (invoice.remaining as number)),
          reason: `HitPay payment ${request.referenceNumber} is above the open balance.`,
        };
  if ((body.kind === "single" && (body.amount as number) === 0) || (invoice.remaining as number) === 0) {
    info.outcome = amountsMatch ? "applied" : "amount_mismatch";
    return null;
  }
  const suggestion = addSuggestion(s, credit, body, now, audits, { kind: "system" }, evidence);
  if (auto) {
    const allocation = allocationsFor(s, suggestion.id)[0];
    const approver = { kind: "system" as const, via: "verified_remainder_webhook" as const, receiptId: cmd.event.receiptId, paymentRequestId: request.id };
    approveAllocation(s, allocation, approver, now, audits, evidence);
    commitAllocation(s, allocation, now, audits, evidence);
    suggestion.status = "accepted";
    request.status = "completed";
    queueCutoff(followUps, invoice.customerId);
    info.outcome = "applied";
  } else {
    info.outcome = amountsMatch ? "applied" : "amount_mismatch";
  }
  return null;
}

function nextDelivery(s: LedgerSnapshot, customerId: CustomerId): Delivery | null {
  const rows = [...s.deliveries.values()]
    .filter((row) => row.customerId === customerId && row.status === "on_credit" && row.creditDecisionBy == null && row.scheduledFor >= s.today)
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1));
  return rows[0] ?? null;
}

function checkCutoff(s: LedgerSnapshot, customerId: CustomerId | "all", now: Instant, audits: AuditEvent[]): Rejection | null {
  const customers = customerId === "all" ? [...s.customers.values()] : [s.customers.get(customerId)].filter((row): row is Customer => row != null);
  if (customerId !== "all" && customers.length === 0) return rej("not_found", String(customerId));
  for (const customer of customers) {
    const balances = [...s.invoices.values()]
      .filter((inv) => inv.customerId === customer.id)
      .map((invoice) => ({ invoice, balance: invoiceBalance(invoice, [...s.allocations.values()], s.writeOffs) }));
    const overdue = overdueBalance(balances, s.settings, s.today);
    const decision = evaluateCutOff({
      hold: customer.hold,
      overdue,
      settings: s.settings,
      nextDelivery: nextDelivery(s, customer.id),
    });
    if (!decision.propose) continue;
    const delivery = s.deliveries.get(decision.deliveryId);
    if (!delivery || delivery.status !== "on_credit") continue;
    customer.hold = { status: "proposed", deliveryId: delivery.id, proposedAt: now, overdue: decision.overdue };
    delivery.status = "proposed_pay_first";
    audits.push(
        makeAudit(s, now, { kind: "system" }, "customer", customer.id, "propose_hold", { status: "normal" }, { status: "proposed", deliveryId: delivery.id, overdue: decision.overdue, policyVersion: s.policyVersion }, {
        kind: "threshold",
        overdue: decision.overdue,
        threshold: decision.threshold,
        deliveryId: delivery.id,
      }),
    );
  }
  return null;
}

function approveHold(s: LedgerSnapshot, customerId: CustomerId, by: HumanActor, now: Instant, audits: AuditEvent[], info: Record<string, string | number>): Rejection | null {
  const customer = s.customers.get(customerId);
  if (!customer) return rej("not_found", String(customerId));
  if (customer.hold.status !== "proposed") return rej("illegal_transition", customer.hold.status);
  const delivery = s.deliveries.get(customer.hold.deliveryId);
  if (!delivery || delivery.status !== "proposed_pay_first") return rej("illegal_transition", delivery?.status ?? "missing");
  customer.hold = { status: "pay_first", deliveryId: delivery.id, approvedBy: by, approvedAt: now };
  delivery.status = "pay_first";
  audits.push(makeAudit(s, now, by, "customer", customer.id, "approve_hold", { status: "proposed" }, { status: "pay_first", deliveryId: delivery.id }, { kind: "human_reason", reason: "approve hold" }));
  return createPaymentRequest(s, { kind: "pay_first", deliveryId: delivery.id }, by, now, audits, info);
}

function releaseHold(
  s: LedgerSnapshot,
  customerId: CustomerId,
  expected: "proposed" | "pay_first",
  action: string,
  by: HumanActor,
  reason: string,
  now: Instant,
  audits: AuditEvent[],
): Rejection | null {
  if (reason.trim() === "") return rej("wrong_actor", "a reason is required");
  const customer = s.customers.get(customerId);
  if (!customer) return rej("not_found", String(customerId));
  if (customer.hold.status !== expected) return rej("illegal_transition", customer.hold.status);
  const delivery = s.deliveries.get(customer.hold.deliveryId);
  if (!delivery) return rej("not_found", String(customer.hold.deliveryId));
  const previous = delivery.status;
  customer.hold = { status: "normal" };
  delivery.status = "on_credit";
  delivery.creditDecisionBy = by;
  audits.push(makeAudit(s, now, by, "customer", customer.id, action, { status: expected }, { status: "normal" }, { kind: "human_reason", reason }));
  audits.push(makeAudit(s, now, by, "delivery", delivery.id, action, { status: previous }, { status: "on_credit" }, { kind: "human_reason", reason }));
  return null;
}

export function decide(state: LedgerSnapshot, cmd: Command, now: Instant): Result<Change, Rejection> {
  const snapshot = structuredClone(state);
  const audit: AuditEvent[] = [];
  const followUps: Command[] = [];
  const info: Record<string, string | number> = {};
  const error = apply(snapshot, cmd, now, audit, followUps, info);
  if (error) return { ok: false, error };
  const balanceError = recompute(snapshot);
  if (balanceError) return { ok: false, error: balanceError };
  snapshot.audit = [...snapshot.audit, ...audit];
  return { ok: true, value: { snapshot, audit, followUps, info } };
}
