import type { DatabaseSync } from "node:sqlite";
import { addDays, inCandidateWindow } from "@/domain/dates";
import { match } from "@/domain/match";
import { cents, formatSgd, type Cents } from "@/domain/money";
import type { CustomerId, Instant, InvoiceId, SuggestionId } from "@/domain/ids";
import type { BankCredit, HumanActor, LedgerSnapshot, StoredSuggestion } from "@/domain/types";
import { readEnv } from "@/server/env";
import { parseDbs } from "@/server/import/dbs";
import { aliasesInText, explainUncertain, readRef, type ExplainInput, type HintRead, type KnownAlias } from "@/server/hints/read";
import type { HitPayGateway } from "@/server/hitpay/gateway";
import { loadHintCache, loadSnapshot, run, saveHintCache, type CachedHint } from "@/server/ledger";

async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 0), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function uncertainRule(rule: string | undefined): rule is "R3" | "R4" | "R5" {
  return rule === "R3" || rule === "R4" || rule === "R5";
}

function candidateFacts(snapshot: LedgerSnapshot, suggestion: StoredSuggestion): { id: string; amount: string }[] {
  const body = suggestion.body;
  const ids = body.kind === "split" ? body.parts.map((part) => part.invoiceId) : body.kind === "choose_one" ? [...body.candidates] : [body.invoiceId];
  return ids.map((id) => {
    const invoice = snapshot.invoices.get(id);
    const amount = body.kind === "split" ? body.parts.find((part) => part.invoiceId === id)?.amount : invoice?.remaining;
    return { id, amount: formatSgd(amount ?? cents(0)) };
  });
}

function explanationInput(credit: BankCredit, suggestion: StoredSuggestion, snapshot: LedgerSnapshot, knownAliases: readonly KnownAlias[]): ExplainInput | null {
  if (!uncertainRule(suggestion.body.rule)) return null;
  return {
    rawRef: credit.rawRef,
    payerName: credit.payerName,
    rule: suggestion.body.rule,
    reason: suggestion.body.reason,
    creditAmount: formatSgd(credit.amount),
    candidates: candidateFacts(snapshot, suggestion),
    confirmedAliases: aliasesInText(credit.rawRef, credit.payerName, knownAliases),
  };
}

function rememberHint(db: DatabaseSync, credit: BankCredit, read: HintRead, explanation: string | null, explainSettled: boolean, now: Instant) {
  saveHintCache(
    db,
    {
      creditId: credit.id,
      fileLine: credit.source.kind === "bank_csv" ? credit.source.fileLine : null,
      alias: read.hints.alias,
      invoiceTokens: [...read.hints.invoiceTokens],
      proposedCustomer: read.proposedCustomer,
      proposedInvoices: read.proposedInvoices,
      explanation,
      fromModel: read.fromModel,
      explainSettled,
    },
    now,
  );
}

function countOf(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  return parseInt(String(value ?? "0"), 10);
}

export const OWNER: HumanActor = { kind: "human", name: "Owner" };

export function importStatus(inserted: number, already: number, review: number): string {
  return `Imported ${inserted} new, ${already} already imported, ${review} need review`;
}

export async function importBytes(db: DatabaseSync, bytes: Uint8Array, fileName: string, actor: HumanActor = OWNER, now: Instant = readEnv().now) {
  const parsed = parseDbs(bytes, fileName);
  if (!parsed.ok) return { ok: false as const, error: parsed.error, status: "" };
  const imported = run(db, { kind: "import_batch", batch: parsed.value, actor }, now);
  if (!imported.ok) return { ok: false as const, error: imported.error, status: "" };
  const known = new Set([...loadSnapshot(db).invoices.keys()]);
  let snapshot = loadSnapshot(db);
  const hintCache = loadHintCache(db);
  const queued: { credit: BankCredit; aliases: { alias: string; customerId: CustomerId; customerName: string }[]; knownAliases: KnownAlias[]; cached?: CachedHint }[] = [];
  for (const credit of snapshot.credits.values()) {
    if (credit.source.kind !== "bank_csv" || credit.source.batchId !== parsed.value.batchId) continue;
    if ([...snapshot.suggestions.values()].some((row) => row.creditId === credit.id)) continue;
    if (credit.reviewFlags.includes("hitpay_payout")) continue;
    const aliases = snapshot.aliases
      .filter((row) => row.confirmedByHuman)
      .map((row) => ({ alias: row.alias, customerId: row.customerId, customerName: snapshot.customers.get(row.customerId)?.name ?? row.alias }));
    queued.push({ credit, aliases, knownAliases: aliases.map((row) => ({ alias: row.alias, name: row.customerName })), cached: hintCache.get(credit.id) });
  }
  const reads = await mapPool(queued, 4, (row) =>
    row.cached
      ? Promise.resolve({ hints: { alias: row.cached.alias, invoiceTokens: row.cached.invoiceTokens }, proposedCustomer: row.cached.proposedCustomer, proposedInvoices: row.cached.proposedInvoices, fromModel: row.cached.fromModel, transportFailed: false })
      : readRef(row.credit.rawRef, row.credit.payerName, known, row.knownAliases),
  );
  const matched: { credit: BankCredit; knownAliases: KnownAlias[]; read: HintRead; suggestion?: StoredSuggestion; cached?: CachedHint }[] = [];
  for (let index = 0; index < queued.length; index += 1) {
    const row = queued[index];
    const read = reads[index];
    run(db, { kind: "record_hint", creditId: row.credit.id, hints: read.hints }, now);
    const open = [...snapshot.invoices.values()]
      .filter((inv) => (inv.remaining as number) > 0 && inCandidateWindow(inv.issuedOn, row.credit.valueDate))
      .map((inv) => ({ id: inv.id, customerId: inv.customerId, remaining: inv.remaining, issuedOn: inv.issuedOn }));
    const result = match({ credit: { amount: row.credit.amount, rawRef: row.credit.rawRef, payerName: row.credit.payerName, valueDate: row.credit.valueDate }, openInvoices: open, confirmedAliases: row.aliases, hints: read.hints });
    run(db, { kind: "record_suggestions", creditId: row.credit.id, result }, now);
    snapshot = loadSnapshot(db);
    matched.push({ credit: row.credit, knownAliases: row.knownAliases, read, suggestion: [...snapshot.suggestions.values()].find((item) => item.creditId === row.credit.id), cached: row.cached });
  }
  const explainJobs = matched.filter((row) => !row.cached && readEnv().hintsApiKey && !row.read.transportFailed && row.suggestion && uncertainRule(row.suggestion.body.rule) && row.read.fromModel);
  const explanations = await mapPool(explainJobs, 4, async (row) => {
    const input = explanationInput(row.credit, row.suggestion!, snapshot, row.knownAliases);
    return input ? explainUncertain(input) : { text: null, transportFailed: false };
  });
  explainJobs.forEach((row, index) => {
    const explained = explanations[index];
    rememberHint(db, row.credit, row.read, explained.text, !explained.transportFailed, now);
  });
  for (const row of matched) {
    if (row.cached || !readEnv().hintsApiKey || row.read.transportFailed) continue;
    if (explainJobs.includes(row)) continue;
    rememberHint(db, row.credit, row.read, null, true, now);
  }
  const info = imported.value.info;
  return { ok: true as const, status: importStatus(countOf(info.inserted), countOf(info.already), countOf(info.review)) };
}

export function approveSuggestion(db: DatabaseSync, suggestionId: SuggestionId, pick: InvoiceId | null, actor: HumanActor = OWNER, now: Instant = readEnv().now) {
  return run(db, { kind: "approve", suggestionId, pick, by: actor }, now);
}

export function approvePreselected(db: DatabaseSync, actor: HumanActor = OWNER, now: Instant = readEnv().now) {
  return run(db, { kind: "approve_preselected", by: actor }, now);
}

export function rejectSuggestion(db: DatabaseSync, suggestionId: SuggestionId, actor: HumanActor = OWNER, now: Instant = readEnv().now) {
  return run(db, { kind: "reject", suggestionId, by: actor }, now);
}

export function undoAllocation(db: DatabaseSync, allocationId: string, actor: HumanActor = OWNER, now: Instant = readEnv().now) {
  return run(db, { kind: "undo", allocationId: allocationId as never, by: actor }, now);
}

export function commitApproved(db: DatabaseSync, actor: HumanActor = OWNER, now: Instant = readEnv().now) {
  return run(db, { kind: "commit_approved", by: actor }, now);
}

let hintFill: Promise<void> | null = null;

export function explanationsPending(snapshot: LedgerSnapshot, cache: ReadonlyMap<string, CachedHint>): boolean {
  if (!readEnv().hintsApiKey) return false;
  for (const credit of snapshot.credits.values()) {
    if (credit.source.kind !== "bank_csv") continue;
    const suggestion = [...snapshot.suggestions.values()].find((row) => row.creditId === credit.id && row.status !== "rejected");
    if (!uncertainRule(suggestion?.body.rule)) continue;
    const cached = cache.get(credit.id);
    if (!cached || !cached.explainSettled) return true;
  }
  return false;
}

async function fillReviewHints(db: DatabaseSync, now: Instant) {
  const snapshot = loadSnapshot(db);
  const cache = loadHintCache(db);
  const known = new Set([...snapshot.invoices.keys()]);
  const knownAliases = snapshot.aliases.filter((row) => row.confirmedByHuman).map((row) => ({ alias: row.alias, name: snapshot.customers.get(row.customerId)?.name ?? row.alias }));
  const queued = [...snapshot.credits.values()].filter((credit) => {
    if (credit.source.kind !== "bank_csv") return false;
    const suggestion = [...snapshot.suggestions.values()].find((row) => row.creditId === credit.id && row.status !== "rejected");
    if (!uncertainRule(suggestion?.body.rule)) return false;
    const cached = cache.get(credit.id);
    return !cached || !cached.explainSettled;
  });
  const reads = await mapPool(queued, 4, (credit) => {
    const cached = cache.get(credit.id);
    if (cached) {
      return Promise.resolve({ hints: { alias: cached.alias, invoiceTokens: cached.invoiceTokens }, proposedCustomer: cached.proposedCustomer, proposedInvoices: cached.proposedInvoices, fromModel: cached.fromModel, transportFailed: false });
    }
    return readRef(credit.rawRef, credit.payerName, known, knownAliases);
  });
  const explanations = await mapPool(queued, 4, async (credit, index) => {
    const read = reads[index];
    const suggestion = [...snapshot.suggestions.values()].find((row) => row.creditId === credit.id && row.status !== "rejected");
    if (!read.fromModel || read.transportFailed || !suggestion) return { text: null, transportFailed: read.transportFailed };
    const input = explanationInput(credit, suggestion, snapshot, knownAliases);
    return input ? explainUncertain(input) : { text: null, transportFailed: false };
  });
  queued.forEach((credit, index) => {
    const read = reads[index];
    const explained = explanations[index];
    if (read.transportFailed || explained.transportFailed) return;
    rememberHint(db, credit, read, explained.text, true, now);
  });
}

export function ensureReviewHints(db: DatabaseSync, now: Instant = readEnv().now) {
  if (!readEnv().hintsApiKey) return Promise.resolve();
  if (hintFill) return hintFill;
  hintFill = fillReviewHints(db, now).finally(() => {
    hintFill = null;
  });
  return hintFill;
}

export async function requestRemainder(db: DatabaseSync, gateway: HitPayGateway, invoiceId: InvoiceId, actor: HumanActor = OWNER, now: Instant = readEnv().now) {
  const env = readEnv();
  const created = run(db, { kind: "create_payment_request", purpose: { kind: "remainder", invoiceId }, by: actor }, now);
  if (!created.ok) return created;
  if (created.value.info.existing === 1) return created;
  const amount = cents(created.value.info.amount as number);
  const referenceNumber = String(created.value.info.referenceNumber) as never;
  const made = await gateway.createPaymentRequest({
    referenceNumber,
    amount,
    purpose: "remainder",
    expiresAt: `${addDays(env.today, 7)} 23:59:59`,
    webhookUrl: `${env.appUrl}/api/hitpay/webhook`,
  });
  if (!made.ok) return { ok: false as const, error: { code: "not_found" as const, detail: made.error.detail } };
  return run(db, { kind: "payment_request_created", id: String(created.value.info.paymentRequestId) as never, hitpayRequestId: made.value.hitpayRequestId, url: made.value.url }, now);
}

export async function approveCustomerHold(db: DatabaseSync, gateway: HitPayGateway, customerId: CustomerId, actor: HumanActor = OWNER, now: Instant = readEnv().now) {
  const env = readEnv();
  const created = run(db, { kind: "approve_hold", customerId, by: actor }, now);
  if (!created.ok) return created;
  const amount = cents(created.value.info.amount as number);
  const referenceNumber = String(created.value.info.referenceNumber) as never;
  const made = await gateway.createPaymentRequest({
    referenceNumber,
    amount,
    purpose: "pay_first",
    expiresAt: `${addDays(env.today, 1)} 23:59:59`,
    webhookUrl: `${env.appUrl}/api/hitpay/webhook`,
  });
  if (!made.ok) return { ok: false as const, error: { code: "not_found" as const, detail: made.error.detail } };
  return run(db, { kind: "payment_request_created", id: String(created.value.info.paymentRequestId) as never, hitpayRequestId: made.value.hitpayRequestId, url: made.value.url }, now);
}

export function checkCutoff(db: DatabaseSync, customerId: CustomerId | "all", actor: HumanActor = OWNER, now: Instant = readEnv().now) {
  return run(db, { kind: "check_cutoff", customerId, by: actor }, now);
}

export { cents };
export type { Cents };
