import type { DatabaseSync } from "node:sqlite";
import { cents, type Result } from "@/domain/money";
import { asInvoiceId, asIsoDate, type CreditId, type CustomerId, type DeliveryId, type ImportBatchId, type Instant, type PaymentRequestId, type ReceiptId } from "@/domain/ids";
import { decide } from "@/domain/decide";
import type { AuditEvent, Change, Command, Customer, Delivery, Hold, HumanActor, Invoice, LedgerSnapshot, PaymentRequest, Rejection, StoredSuggestion, SuggestionBody, WebhookReceipt, WriteOff, Allocation, BankCredit } from "@/domain/types";
import { openDatabase, withTx } from "@/server/db";
import { readEnv } from "@/server/env";

type Row = Record<string, unknown>;

function asInt(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return parseInt(value.toString(), 10);
  return parseInt(String(value), 10);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: unknown): T {
  return JSON.parse(String(value)) as T;
}

function emptySnapshot(): LedgerSnapshot {
  const env = readEnv();
  return {
    seq: 1,
    credits: new Map(),
    suggestions: new Map(),
    allocations: new Map(),
    invoices: new Map(),
    writeOffs: [],
    customers: new Map(),
    aliases: [],
    deliveries: new Map(),
    paymentRequests: new Map(),
    receipts: [],
    settings: { overdueBalanceThreshold: cents(3000), overdueDaysThreshold: null },
    policyVersion: 0,
    audit: [],
    today: env.today,
    autoApproveRemainder: env.autoApproveRemainder,
  };
}

function holdFrom(row: Row): Hold {
  if (row.hold_status === "proposed") {
    return {
      status: "proposed",
      deliveryId: String(row.hold_delivery_id) as DeliveryId,
      proposedAt: String(row.hold_proposed_at) as Instant,
      overdue: cents(asInt(row.hold_overdue_cents ?? 0)),
    };
  }
  if (row.hold_status === "pay_first") {
    return {
      status: "pay_first",
      deliveryId: String(row.hold_delivery_id) as DeliveryId,
      approvedBy: parseJson(row.hold_approved_by),
      approvedAt: String(row.hold_approved_at) as Instant,
    };
  }
  return { status: "normal" };
}

function suggestionBody(row: Row): SuggestionBody {
  const reason = String(row.reason);
  if (row.kind === "split") {
    return { kind: "split", rule: "R4", tier: "B", parts: parseJson(row.parts_json), preselected: false, reason };
  }
  if (row.kind === "choose_one") {
    return { kind: "choose_one", rule: "R5", tier: "C", candidates: parseJson(row.candidates_json), amount: cents(asInt(row.amount_cents)), preselected: false, reason };
  }
  if (row.rule === "R1") {
    return { kind: "single", rule: "R1", tier: "A", invoiceId: asInvoiceId(String(row.invoice_id)), amount: cents(asInt(row.amount_cents)), preselected: true, reason };
  }
  return {
    kind: "single",
    rule: row.rule as "R2" | "R3" | "R6",
    tier: row.tier as "B" | "C",
    invoiceId: asInvoiceId(String(row.invoice_id)),
    amount: cents(asInt(row.amount_cents)),
    preselected: false,
    shortfall: row.shortfall_cents == null ? null : cents(asInt(row.shortfall_cents)),
    unallocated: row.unallocated_cents == null ? null : cents(asInt(row.unallocated_cents)),
    reason,
  };
}

export function loadSnapshot(db: DatabaseSync): LedgerSnapshot {
  const snap = emptySnapshot();
  const seq = db.prepare("SELECT value FROM meta WHERE key = 'seq'").get() as { value?: string } | undefined;
  if (seq?.value) snap.seq = parseInt(seq.value, 10);
  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get() as Row | undefined;
  if (settings) {
    snap.policyVersion = asInt(settings.policy_version ?? 0);
    snap.settings = {
      overdueBalanceThreshold: cents(asInt(settings.overdue_balance_threshold_cents)),
      overdueDaysThreshold: settings.overdue_days_threshold == null ? null : asInt(settings.overdue_days_threshold),
    };
  }
  for (const row of db.prepare("SELECT * FROM customer").all() as Row[]) {
    const customer: Customer = { id: String(row.id) as CustomerId, name: String(row.name), hold: holdFrom(row) };
    snap.customers.set(customer.id, customer);
  }
  for (const row of db.prepare("SELECT * FROM customer_alias").all() as Row[]) {
    snap.aliases.push({ customerId: String(row.customer_id) as CustomerId, alias: String(row.alias), confirmedByHuman: asInt(row.confirmed_by_human) === 1 });
  }
  for (const row of db.prepare("SELECT * FROM invoice").all() as Row[]) {
    const invoice: Invoice = {
      id: asInvoiceId(String(row.id)),
      hitpayInvoiceId: row.hitpay_invoice_id == null ? null : String(row.hitpay_invoice_id),
      stripeInvoiceId: row.stripe_invoice_id == null ? null : String(row.stripe_invoice_id),
      customerId: String(row.customer_id) as CustomerId,
      total: cents(asInt(row.total_cents)),
      issuedOn: asIsoDate(String(row.issued_on)),
      dueOn: row.due_on == null ? null : asIsoDate(String(row.due_on)),
      followUpOn: row.follow_up_on == null ? null : asIsoDate(String(row.follow_up_on)),
      allocated: cents(asInt(row.allocated_cents)),
      writtenOff: cents(asInt(row.written_off_cents)),
      remaining: cents(asInt(row.amount_remaining_cents)),
      status: String(row.status) as Invoice["status"],
    };
    snap.invoices.set(invoice.id, invoice);
  }
  for (const row of db.prepare("SELECT * FROM bank_credit").all() as Row[]) {
    const credit: BankCredit = {
      id: String(row.id) as CreditId,
      source:
        row.source_kind === "hitpay_webhook"
          ? { kind: "hitpay_webhook", receiptId: String(row.receipt_id) as ReceiptId, paymentRequestId: String(row.payment_request_id) as PaymentRequestId }
          : {
              kind: "bank_csv",
              bank: String(row.bank) as "DBS" | "OCBC" | "UOB",
              batchId: String(row.batch_id) as ImportBatchId,
              fileLine: asInt(row.file_line),
              bankTxnId: row.bank_txn_id == null ? null : String(row.bank_txn_id),
            },
      dedupeKey: String(row.dedupe_key) as BankCredit["dedupeKey"],
      valueDate: asIsoDate(String(row.value_date)),
      amount: cents(asInt(row.amount_cents)),
      rawRef: String(row.raw_ref),
      payerName: String(row.payer_name),
      reviewFlags: parseJson(row.review_flags),
      unallocated: cents(asInt(row.unallocated_cents)),
    };
    snap.credits.set(credit.id, credit);
  }
  for (const row of db.prepare("SELECT * FROM suggestion").all() as Row[]) {
    const stored: StoredSuggestion = { id: String(row.id) as StoredSuggestion["id"], creditId: String(row.bank_credit_id) as CreditId, status: String(row.status) as StoredSuggestion["status"], body: suggestionBody(row) };
    snap.suggestions.set(stored.id, stored);
  }
  for (const row of db.prepare("SELECT * FROM allocation").all() as Row[]) {
    const allocation: Allocation = {
      id: String(row.id) as Allocation["id"],
      suggestionId: String(row.suggestion_id) as Allocation["suggestionId"],
      creditId: String(row.bank_credit_id) as CreditId,
      invoiceId: asInvoiceId(String(row.invoice_id)),
      amount: cents(asInt(row.amount_cents)),
      state: String(row.state) as Allocation["state"],
      tier: String(row.tier) as Allocation["tier"],
      rule: String(row.rule) as Allocation["rule"],
      reason: String(row.reason),
      approvedBy: row.approved_by == null ? null : parseJson(row.approved_by),
      approvedAt: row.approved_at == null ? null : (String(row.approved_at) as Instant),
      reconciledAt: row.reconciled_at == null ? null : (String(row.reconciled_at) as Instant),
      rejectedBy: row.rejected_by == null ? null : parseJson(row.rejected_by),
      rejectedAt: row.rejected_at == null ? null : (String(row.rejected_at) as Instant),
      reversedBy: row.reversed_by == null ? null : parseJson(row.reversed_by),
      reversedReason: row.reversed_reason == null ? null : String(row.reversed_reason),
      reversedAt: row.reversed_at == null ? null : (String(row.reversed_at) as Instant),
    };
    snap.allocations.set(allocation.id, allocation);
  }
  for (const row of db.prepare("SELECT * FROM write_off").all() as Row[]) {
    const writeOff: WriteOff = { id: String(row.id), invoiceId: asInvoiceId(String(row.invoice_id)), amount: cents(asInt(row.amount_cents)), by: parseJson(row.by_json), reason: String(row.reason), at: String(row.at) as Instant };
    snap.writeOffs.push(writeOff);
  }
  for (const row of db.prepare("SELECT * FROM delivery").all() as Row[]) {
    const delivery: Delivery = {
      id: String(row.id) as DeliveryId,
      customerId: String(row.customer_id) as CustomerId,
      scheduledFor: asIsoDate(String(row.scheduled_for)),
      amount: cents(asInt(row.amount_cents)),
      status: String(row.status) as Delivery["status"],
      paymentRequestId: row.payment_request_id == null ? null : (String(row.payment_request_id) as PaymentRequestId),
      creditDecisionBy: row.credit_decision_by == null ? null : parseJson(row.credit_decision_by),
    };
    snap.deliveries.set(delivery.id, delivery);
  }
  for (const row of db.prepare("SELECT * FROM payment_request").all() as Row[]) {
    const purpose = row.kind === "pay_first" ? { kind: "pay_first" as const, deliveryId: String(row.delivery_id) as DeliveryId } : { kind: "remainder" as const, invoiceId: asInvoiceId(String(row.invoice_id)) };
    const request: PaymentRequest = {
      id: String(row.id) as PaymentRequestId,
      purpose,
      referenceNumber: String(row.reference_number) as PaymentRequest["referenceNumber"],
      amount: cents(asInt(row.amount_cents)),
      status: String(row.status) as PaymentRequest["status"],
      hitpayRequestId: row.hitpay_request_id == null ? null : (String(row.hitpay_request_id) as PaymentRequest["hitpayRequestId"]),
      url: row.url == null ? null : String(row.url),
      createdAt: String(row.created_at) as Instant,
    };
    snap.paymentRequests.set(request.id, request);
  }
  for (const row of db.prepare("SELECT * FROM webhook_receipt").all() as Row[]) {
    const receipt: WebhookReceipt = {
      id: String(row.id) as ReceiptId,
      receivedAt: String(row.received_at) as Instant,
      eventType: row.event_type == null ? null : String(row.event_type),
      signatureOk: asInt(row.signature_ok) === 1,
      hitpayRequestId: row.hitpay_request_id == null ? null : (String(row.hitpay_request_id) as WebhookReceipt["hitpayRequestId"]),
      dedupeKey: row.dedupe_key == null ? null : String(row.dedupe_key),
      outcome: String(row.outcome),
      rawBodySha256: String(row.raw_body_sha256),
      source: row.source === "poll" ? "poll" : "webhook",
    };
    snap.receipts.push(receipt);
  }
  for (const row of db.prepare("SELECT * FROM audit_event ORDER BY id").all() as Row[]) {
    const event: AuditEvent = {
      id: String(row.id),
      at: String(row.at) as Instant,
      actor: parseJson(row.actor),
      entity: String(row.entity),
      entityId: String(row.entity_id),
      action: String(row.action),
      before: row.before_json == null ? null : parseJson(row.before_json),
      after: row.after_json == null ? null : parseJson(row.after_json),
      evidence: parseJson(row.evidence),
    };
    snap.audit.push(event);
  }
  return snap;
}

function upsert(db: DatabaseSync, sql: string, params: unknown[]) {
  db.prepare(sql).run(...(params as never[]));
}

export function persist(db: DatabaseSync, snap: LedgerSnapshot, audits: readonly AuditEvent[]) {
  upsert(db, "INSERT INTO meta (key, value) VALUES ('seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(snap.seq)]);
  upsert(
    db,
    "INSERT INTO settings (id, overdue_balance_threshold_cents, overdue_days_threshold, policy_version) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET overdue_balance_threshold_cents = excluded.overdue_balance_threshold_cents, overdue_days_threshold = excluded.overdue_days_threshold, policy_version = excluded.policy_version",
    [snap.settings.overdueBalanceThreshold, snap.settings.overdueDaysThreshold, snap.policyVersion],
  );
  for (const customer of snap.customers.values()) {
    const hold = customer.hold;
    upsert(
      db,
      `INSERT INTO customer (id, name, hold_status, hold_delivery_id, hold_proposed_at, hold_overdue_cents, hold_approved_by, hold_approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, hold_status = excluded.hold_status, hold_delivery_id = excluded.hold_delivery_id, hold_proposed_at = excluded.hold_proposed_at, hold_overdue_cents = excluded.hold_overdue_cents, hold_approved_by = excluded.hold_approved_by, hold_approved_at = excluded.hold_approved_at`,
      [
        customer.id,
        customer.name,
        hold.status,
        hold.status === "normal" ? null : hold.deliveryId,
        hold.status === "proposed" ? hold.proposedAt : null,
        hold.status === "proposed" ? hold.overdue : null,
        hold.status === "pay_first" ? json(hold.approvedBy) : null,
        hold.status === "pay_first" ? hold.approvedAt : null,
      ],
    );
  }
  for (const alias of snap.aliases) {
    upsert(
      db,
      "INSERT INTO customer_alias (customer_id, alias, confirmed_by_human) VALUES (?, ?, ?) ON CONFLICT(alias) DO UPDATE SET customer_id = excluded.customer_id, confirmed_by_human = excluded.confirmed_by_human",
      [alias.customerId, alias.alias, alias.confirmedByHuman ? 1 : 0],
    );
  }
  for (const inv of snap.invoices.values()) {
    upsert(
      db,
      `INSERT INTO invoice (id, hitpay_invoice_id, stripe_invoice_id, customer_id, total_cents, allocated_cents, written_off_cents, amount_remaining_cents, status, issued_on, follow_up_on, due_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET allocated_cents = excluded.allocated_cents, written_off_cents = excluded.written_off_cents, amount_remaining_cents = excluded.amount_remaining_cents, status = excluded.status, hitpay_invoice_id = excluded.hitpay_invoice_id`,
      [inv.id, inv.hitpayInvoiceId, inv.stripeInvoiceId, inv.customerId, inv.total, inv.allocated, inv.writtenOff, inv.remaining, inv.status, inv.issuedOn, inv.followUpOn, inv.dueOn],
    );
  }
  for (const credit of snap.credits.values()) {
    const source = credit.source;
    upsert(
      db,
      `INSERT INTO bank_credit (id, source_kind, bank, batch_id, file_line, bank_txn_id, receipt_id, payment_request_id, dedupe_key, value_date, amount_cents, raw_ref, payer_name, unallocated_cents, review_flags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET unallocated_cents = excluded.unallocated_cents, review_flags = excluded.review_flags`,
      [
        credit.id,
        source.kind,
        source.kind === "bank_csv" ? source.bank : null,
        source.kind === "bank_csv" ? source.batchId : null,
        source.kind === "bank_csv" ? source.fileLine : null,
        source.kind === "bank_csv" ? source.bankTxnId : null,
        source.kind === "hitpay_webhook" ? source.receiptId : null,
        source.kind === "hitpay_webhook" ? source.paymentRequestId : null,
        credit.dedupeKey,
        credit.valueDate,
        credit.amount,
        credit.rawRef,
        credit.payerName,
        credit.unallocated,
        json(credit.reviewFlags),
      ],
    );
  }
  for (const suggestion of snap.suggestions.values()) {
    const body = suggestion.body;
    upsert(
      db,
      `INSERT INTO suggestion (id, bank_credit_id, kind, rule, tier, preselected, reason, status, invoice_id, amount_cents, shortfall_cents, unallocated_cents, parts_json, candidates_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, reason = excluded.reason`,
      [
        suggestion.id,
        suggestion.creditId,
        body.kind,
        body.rule,
        body.tier,
        body.preselected ? 1 : 0,
        body.reason,
        suggestion.status,
        body.kind === "single" ? body.invoiceId : null,
        body.kind === "split" ? null : body.amount,
        body.kind === "single" && body.rule !== "R1" ? body.shortfall : null,
        body.kind === "single" && body.rule !== "R1" ? body.unallocated : null,
        body.kind === "split" ? json(body.parts) : null,
        body.kind === "choose_one" ? json(body.candidates) : null,
      ],
    );
  }
  for (const allocation of snap.allocations.values()) {
    upsert(
      db,
      `INSERT INTO allocation (id, suggestion_id, bank_credit_id, invoice_id, amount_cents, state, tier, rule, reason, approved_by, approved_at, reconciled_at, rejected_by, rejected_at, reversed_by, reversed_reason, reversed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state = excluded.state, approved_by = excluded.approved_by, approved_at = excluded.approved_at, reconciled_at = excluded.reconciled_at, rejected_by = excluded.rejected_by, rejected_at = excluded.rejected_at, reversed_by = excluded.reversed_by, reversed_reason = excluded.reversed_reason, reversed_at = excluded.reversed_at`,
      [
        allocation.id,
        allocation.suggestionId,
        allocation.creditId,
        allocation.invoiceId,
        allocation.amount,
        allocation.state,
        allocation.tier,
        allocation.rule,
        allocation.reason,
        allocation.approvedBy ? json(allocation.approvedBy) : null,
        allocation.approvedAt,
        allocation.reconciledAt,
        allocation.rejectedBy ? json(allocation.rejectedBy) : null,
        allocation.rejectedAt,
        allocation.reversedBy ? json(allocation.reversedBy) : null,
        allocation.reversedReason,
        allocation.reversedAt,
      ],
    );
  }
  for (const writeOff of snap.writeOffs) {
    upsert(
      db,
      "INSERT INTO write_off (id, invoice_id, amount_cents, by_json, reason, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
      [writeOff.id, writeOff.invoiceId, writeOff.amount, json(writeOff.by), writeOff.reason, writeOff.at],
    );
  }
  for (const delivery of snap.deliveries.values()) {
    upsert(
      db,
      `INSERT INTO delivery (id, customer_id, scheduled_for, amount_cents, status, payment_request_id, credit_decision_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, payment_request_id = excluded.payment_request_id, credit_decision_by = excluded.credit_decision_by`,
      [delivery.id, delivery.customerId, delivery.scheduledFor, delivery.amount, delivery.status, delivery.paymentRequestId, delivery.creditDecisionBy ? json(delivery.creditDecisionBy) : null],
    );
  }
  for (const request of snap.paymentRequests.values()) {
    upsert(
      db,
      `INSERT INTO payment_request (id, kind, invoice_id, delivery_id, hitpay_request_id, reference_number, amount_cents, status, url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, hitpay_request_id = excluded.hitpay_request_id, url = excluded.url`,
      [
        request.id,
        request.purpose.kind,
        request.purpose.kind === "remainder" ? request.purpose.invoiceId : null,
        request.purpose.kind === "pay_first" ? request.purpose.deliveryId : null,
        request.hitpayRequestId,
        request.referenceNumber,
        request.amount,
        request.status,
        request.url,
        request.createdAt,
      ],
    );
  }
  for (const receipt of snap.receipts) {
    upsert(
      db,
      `INSERT INTO webhook_receipt (id, received_at, event_type, signature_ok, hitpay_request_id, dedupe_key, outcome, raw_body_sha256, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET outcome = excluded.outcome, signature_ok = excluded.signature_ok, source = excluded.source, event_type = excluded.event_type, raw_body_sha256 = excluded.raw_body_sha256`,
      [receipt.id, receipt.receivedAt, receipt.eventType, receipt.signatureOk ? 1 : 0, receipt.hitpayRequestId, receipt.dedupeKey, receipt.outcome, receipt.rawBodySha256, receipt.source],
    );
  }
  for (const event of audits) {
    upsert(
      db,
      "INSERT INTO audit_event (id, at, actor, entity, entity_id, action, before_json, after_json, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [event.id, event.at, json(event.actor), event.entity, event.entityId, event.action, event.before == null ? null : json(event.before), event.after == null ? null : json(event.after), json(event.evidence)],
    );
  }
}

export interface RunOk {
  snapshot: LedgerSnapshot;
  audit: AuditEvent[];
  info: Record<string, string | number>;
}

function applyAll(start: LedgerSnapshot, cmd: Command, now: Instant): Result<{ snapshot: LedgerSnapshot; audit: AuditEvent[]; info: Record<string, string | number> }, Rejection> {
  let snapshot = start;
  const queue = [cmd];
  const audit: AuditEvent[] = [];
  const info: Record<string, string | number> = {};
  let guard = 0;
  while (queue.length > 0) {
    guard += 1;
    if (guard > 40) throw new Error("follow-up loop");
    const next = queue.shift();
    if (!next) break;
    const decided = decide(snapshot, next, now);
    if (!decided.ok) return decided;
    snapshot = decided.value.snapshot;
    audit.push(...decided.value.audit);
    Object.assign(info, decided.value.info);
    queue.push(...decided.value.followUps);
  }
  return { ok: true, value: { snapshot, audit, info } };
}

export function run(db: DatabaseSync, cmd: Command, now: Instant = readEnv().now): Result<RunOk, Rejection> {
  return withTx(db, () => {
    const applied = applyAll(loadSnapshot(db), cmd, now);
    if (!applied.ok) return applied;
    persist(db, applied.value.snapshot, applied.value.audit);
    return { ok: true, value: applied.value };
  });
}

export interface ReceiptDraft {
  receivedAt: Instant;
  eventType: string | null;
  signatureOk: boolean;
  hitpayRequestId: WebhookReceipt["hitpayRequestId"];
  dedupeKey: string | null;
  outcome: string;
  rawBodySha256: string;
  source: WebhookReceipt["source"];
}

export interface CachedHint {
  creditId: string;
  fileLine: number | null;
  alias: string | null;
  invoiceTokens: string[];
  proposedCustomer: string | null;
  proposedInvoices: string[];
  explanation: string | null;
  fromModel: boolean;
  explainSettled: boolean;
}

export function commitWebhook(
  db: DatabaseSync,
  draft: ReceiptDraft,
  build: (receiptId: ReceiptId) => Command | null,
  now: Instant = readEnv().now,
): Result<RunOk & { replay: boolean; outcome: string }, Rejection> {
  return withTx(db, () => {
    const start = loadSnapshot(db);
    const prior = draft.dedupeKey ? start.receipts.find((row) => row.dedupeKey === draft.dedupeKey && row.signatureOk) : undefined;
    if (prior && (prior.outcome === "applied" || [...start.credits.values()].some((credit) => credit.source.kind === "hitpay_webhook" && credit.source.receiptId === prior.id) || (prior.outcome === draft.outcome && draft.outcome !== "applied"))) {
      return { ok: true as const, value: { snapshot: start, audit: [], info: {}, replay: true, outcome: prior.outcome } };
    }
    const receiptId = prior ? prior.id : (`RCP-${String(start.seq).padStart(4, "0")}` as ReceiptId);
    if (!prior) start.seq += 1;
    const command = build(receiptId);
    const applied = command ? applyAll(start, command, now) : { ok: true as const, value: { snapshot: start, audit: [] as AuditEvent[], info: {} as Record<string, string | number> } };
    if (!applied.ok) return applied;
    const outcome = String(applied.value.info.outcome ?? draft.outcome);
    const saved = applied.value.snapshot.receipts.find((row) => row.id === receiptId);
    if (saved) {
      saved.outcome = outcome;
      saved.signatureOk = draft.signatureOk;
      saved.eventType = draft.eventType ?? saved.eventType;
      saved.source = draft.source;
      saved.rawBodySha256 = draft.rawBodySha256;
    } else {
      applied.value.snapshot.receipts.push({
        id: receiptId,
        receivedAt: draft.receivedAt,
        eventType: draft.eventType,
        signatureOk: draft.signatureOk,
        hitpayRequestId: draft.hitpayRequestId,
        dedupeKey: draft.dedupeKey,
        outcome,
        rawBodySha256: draft.rawBodySha256,
        source: draft.source,
      });
    }
    persist(db, applied.value.snapshot, applied.value.audit);
    return { ok: true, value: { ...applied.value, replay: false, outcome } };
  });
}

export function loadHintCache(db: DatabaseSync): Map<string, CachedHint> {
  const map = new Map<string, CachedHint>();
  const rows = db.prepare("SELECT bank_credit_id, file_line, payload FROM hint_cache").all() as Row[];
  for (const row of rows) {
    let payload: Partial<CachedHint>;
    try {
      payload = parseJson(row.payload);
    } catch {
      continue;
    }
    if (!payload || typeof payload !== "object") continue;
    map.set(String(row.bank_credit_id), {
      creditId: String(row.bank_credit_id),
      fileLine: row.file_line == null ? null : asInt(row.file_line),
      alias: typeof payload.alias === "string" ? payload.alias : null,
      invoiceTokens: Array.isArray(payload.invoiceTokens) ? payload.invoiceTokens.filter((token): token is string => typeof token === "string") : [],
      proposedCustomer: typeof payload.proposedCustomer === "string" ? payload.proposedCustomer : null,
      proposedInvoices: Array.isArray(payload.proposedInvoices) ? payload.proposedInvoices.filter((token): token is string => typeof token === "string") : [],
      explanation: typeof payload.explanation === "string" ? payload.explanation : null,
      fromModel: payload.fromModel === true,
      explainSettled: typeof payload.explainSettled === "boolean" ? payload.explainSettled : typeof payload.explanation === "string" && payload.explanation.length > 0,
    });
  }
  return map;
}

export function saveHintCache(db: DatabaseSync, hint: CachedHint, now: Instant) {
  const payload = {
    alias: hint.alias,
    invoiceTokens: hint.invoiceTokens,
    proposedCustomer: hint.proposedCustomer,
    proposedInvoices: hint.proposedInvoices,
    explanation: hint.explanation,
    fromModel: hint.fromModel,
    explainSettled: hint.explainSettled,
  };
  db.prepare(
    `INSERT INTO hint_cache (bank_credit_id, file_line, payload, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(bank_credit_id) DO UPDATE SET file_line = excluded.file_line, payload = excluded.payload`,
  ).run(hint.creditId, hint.fileLine, json(payload), now);
}

export function bootstrap(db: DatabaseSync, actor: HumanActor = { kind: "human", name: "Owner" }, now: Instant = readEnv().now) {
  const snap = loadSnapshot(db);
  if (snap.customers.size > 0) return snap;
  const customers = [
    ["CUS-ABC", "ABC Catering", "ABC CAT"],
    ["CUS-AHS", "Ah Seng Eating House", "AH SENG"],
    ["CUS-TBK", "Tan BK Café", "TAN BK"],
  ] as const;
  for (const [id, name, alias] of customers) {
    snap.customers.set(id as CustomerId, { id: id as CustomerId, name, hold: { status: "normal" } });
    snap.aliases.push({ customerId: id as CustomerId, alias, confirmedByHuman: true });
  }
  const invoices = [
    ["INV-104", "CUS-ABC", 50000, "2026-10-28", "2026-11-11"],
    ["INV-105", "CUS-AHS", 50000, "2026-10-30", "2026-11-13"],
    ["INV-110", "CUS-AHS", 18000, "2026-11-05", "2026-12-05"],
    ["INV-041", "CUS-TBK", 50000, "2026-10-15", "2026-11-14"],
    ["INV-042", "CUS-TBK", 30000, "2026-10-15", "2026-11-14"],
  ] as const;
  for (const [id, customerId, total, issued, due] of invoices) {
    const invoice: Invoice = {
      id: asInvoiceId(id),
      hitpayInvoiceId: null,
      stripeInvoiceId: null,
      customerId: customerId as CustomerId,
      total: cents(total),
      issuedOn: asIsoDate(issued),
      dueOn: asIsoDate(due),
      followUpOn: null,
      allocated: cents(0),
      writtenOff: cents(0),
      remaining: cents(total),
      status: "open",
    };
    snap.invoices.set(invoice.id, invoice);
  }
  snap.deliveries.set("DLV-201" as DeliveryId, {
    id: "DLV-201" as DeliveryId,
    customerId: "CUS-ABC" as CustomerId,
    scheduledFor: asIsoDate("2026-11-18"),
    amount: cents(22000),
    status: "on_credit",
    paymentRequestId: null,
    creditDecisionBy: null,
  });
  snap.settings = { overdueBalanceThreshold: cents(3000), overdueDaysThreshold: null };
  const audit: AuditEvent = {
    id: `AUD-${String(snap.seq).padStart(4, "0")}`,
    at: now,
    actor,
    entity: "settings",
    entityId: "settings",
    action: "seeded",
    before: null,
    after: { invoices: 5 },
    evidence: { kind: "human_reason", reason: "demo world" },
  };
  snap.seq += 1;
  persist(db, snap, [audit]);
  return loadSnapshot(db);
}

let singleton: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!singleton) {
    singleton = openDatabase(readEnv().dbPath);
    bootstrap(singleton);
  }
  return singleton;
}

export type { Change };
