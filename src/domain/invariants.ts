import { invoiceBalance, signedRemaining, signedUnallocated } from "@/domain/balances";
import { allocationEdge } from "@/domain/transitions";
import type { AllocationState, AuditEvent, LedgerSnapshot } from "@/domain/types";

export interface Violation {
  id: string;
  detail: string;
}

function auditEdge(event: AuditEvent, id: string): Violation | null {
  if (event.entity !== "allocation") return null;
  if (event.action === "suggest" || event.action === "imported" || event.action === "hint_recorded") return null;
  const before = event.before && typeof event.before === "object" && "state" in event.before ? String(event.before.state) : null;
  const after = event.after && typeof event.after === "object" && "state" in event.after ? String(event.after.state) : null;
  if (!before || !after) return null;
  const next = allocationEdge(before as AllocationState, event.action);
  if (next !== after) return { id, detail: `${event.action} ${before} -> ${after}` };
  return null;
}

export function checkI1(s: LedgerSnapshot): Violation[] {
  const out: Violation[] = [];
  for (const credit of s.credits.values()) {
    if (credit.source.kind !== "bank_csv" && credit.source.kind !== "hitpay_webhook") out.push({ id: "I1", detail: credit.id });
  }
  for (const event of s.audit) {
    if (event.actor.kind === "ai" && event.action !== "hint_recorded") out.push({ id: "I1", detail: event.id });
  }
  return out;
}

export function checkI2(s: LedgerSnapshot): Violation[] {
  const allocs = [...s.allocations.values()];
  const out: Violation[] = [];
  for (const credit of s.credits.values()) {
    const raw = signedUnallocated(credit, allocs);
    const used = (credit.amount as number) - raw;
    if (used > (credit.amount as number) || raw < 0) out.push({ id: "I2", detail: credit.id });
    if ((credit.unallocated as number) !== raw) out.push({ id: "I2", detail: `${credit.id} projection` });
  }
  return out;
}

export function checkI3(s: LedgerSnapshot): Violation[] {
  const allocs = [...s.allocations.values()];
  const out: Violation[] = [];
  for (const inv of s.invoices.values()) {
    const raw = signedRemaining(inv, allocs, s.writeOffs);
    const balance = invoiceBalance(inv, allocs, s.writeOffs);
    const sum = (balance.allocated as number) + (balance.writtenOff as number) + raw;
    if (raw < 0 || sum !== (inv.total as number)) out.push({ id: "I3", detail: inv.id });
  }
  return out;
}

export function checkI4(s: LedgerSnapshot): Violation[] {
  return s.writeOffs
    .filter((row) => row.by.kind !== "human" || row.reason.trim() === "")
    .map((row) => ({ id: "I4", detail: row.id }));
}

export function checkI5(s: LedgerSnapshot): Violation[] {
  return s.audit.flatMap((event) => {
    const violation = auditEdge(event, "I5");
    return violation ? [violation] : [];
  });
}

export function checkI6(s: LedgerSnapshot): Violation[] {
  const out: Violation[] = [];
  for (const allocation of s.allocations.values()) {
    if (!s.audit.some((event) => event.entityId === allocation.id)) out.push({ id: "I6", detail: allocation.id });
  }
  for (const writeOff of s.writeOffs) {
    if (!s.audit.some((event) => event.action === "write_off" && event.entityId === writeOff.invoiceId)) out.push({ id: "I6", detail: writeOff.id });
  }
  for (const request of s.paymentRequests.values()) {
    if (!s.audit.some((event) => event.entityId === request.id)) out.push({ id: "I6", detail: request.id });
  }
  for (const customer of s.customers.values()) {
    if (customer.hold.status !== "normal" && !s.audit.some((event) => event.entityId === customer.id && (event.action === "propose_hold" || event.action === "approve_hold"))) {
      out.push({ id: "I6", detail: customer.id });
    }
  }
  return out;
}

export function checkI7(s: LedgerSnapshot): Violation[] {
  const keys = [...s.credits.values()].map((credit) => credit.dedupeKey);
  if (new Set(keys).size !== keys.length) return [{ id: "I7", detail: "duplicate dedupe key" }];
  return [];
}

export function checkI8(s: LedgerSnapshot): Violation[] {
  const out: Violation[] = [];
  for (const customer of s.customers.values()) {
    if (customer.hold.status === "pay_first" && customer.hold.approvedBy.kind !== "human") out.push({ id: "I8", detail: customer.id });
  }
  return out;
}

export function checkI9(s: LedgerSnapshot): Violation[] {
  const out: Violation[] = [];
  for (const delivery of s.deliveries.values()) {
    if (delivery.status !== "released" || !delivery.paymentRequestId) continue;
    const request = s.paymentRequests.get(delivery.paymentRequestId);
    if (!request || request.purpose.kind !== "pay_first" || request.status !== "completed") out.push({ id: "I9", detail: delivery.id });
  }
  return out;
}

export function checkI10(s: LedgerSnapshot): Violation[] {
  const out: Violation[] = [];
  for (const delivery of s.deliveries.values()) {
    if (delivery.status !== "released") continue;
    const customer = s.customers.get(delivery.customerId);
    if (customer && customer.hold.status === "pay_first" && customer.hold.deliveryId === delivery.id) out.push({ id: "I10", detail: delivery.id });
    if (delivery.paymentRequestId) {
      const request = s.paymentRequests.get(delivery.paymentRequestId);
      if (request && request.purpose.kind === "pay_first" && request.status !== "completed") out.push({ id: "I10", detail: delivery.id });
    }
  }
  return out;
}

export function checkC1(s: LedgerSnapshot): Violation[] {
  const allocs = [...s.allocations.values()];
  const out: Violation[] = [];
  for (const inv of s.invoices.values()) {
    const balance = invoiceBalance(inv, allocs, s.writeOffs);
    if ((inv.allocated as number) !== (balance.allocated as number) || (inv.remaining as number) !== (balance.remaining as number) || inv.status !== balance.status) {
      out.push({ id: "C1", detail: inv.id });
    }
  }
  for (const credit of s.credits.values()) {
    const raw = signedUnallocated(credit, allocs);
    if ((credit.unallocated as number) !== raw) out.push({ id: "C1", detail: credit.id });
  }
  return out;
}

export function checkC2(s: LedgerSnapshot): Violation[] {
  const out: Violation[] = [];
  for (const customer of s.customers.values()) {
    const deliveries = [...s.deliveries.values()].filter((row) => row.customerId === customer.id);
    const proposed = deliveries.filter((row) => row.status === "proposed_pay_first");
    const payFirst = deliveries.filter((row) => row.status === "pay_first");
    if (customer.hold.status === "proposed") {
      if (proposed.length !== 1 || proposed[0].id !== customer.hold.deliveryId) out.push({ id: "C2", detail: customer.id });
    } else if (proposed.length !== 0) out.push({ id: "C2", detail: `${customer.id} proposed` });
    if (customer.hold.status === "pay_first") {
      if (payFirst.length !== 1 || payFirst[0].id !== customer.hold.deliveryId) out.push({ id: "C2", detail: customer.id });
    } else if (payFirst.length !== 0) out.push({ id: "C2", detail: `${customer.id} pay_first` });
  }
  return out;
}

export function checkC3(s: LedgerSnapshot): Violation[] {
  const out: Violation[] = [];
  for (const request of s.paymentRequests.values()) {
    if (request.status !== "completed") continue;
    const applied = s.receipts.filter((row) => row.outcome === "applied" && row.hitpayRequestId && row.hitpayRequestId === request.hitpayRequestId);
    if (applied.length !== 1) out.push({ id: "C3", detail: request.id });
  }
  return out;
}

export const CHECKERS = [checkI1, checkI2, checkI3, checkI4, checkI5, checkI6, checkI7, checkI8, checkI9, checkI10, checkC1, checkC2, checkC3];

export function violations(s: LedgerSnapshot): Violation[] {
  return CHECKERS.flatMap((check) => check(s));
}
