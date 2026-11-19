import fc from "fast-check";
import { expect, test } from "vitest";
import { cents, formatSgd, parseSgd } from "@/domain/money";
import { HintsSchema } from "@/domain/hints";
import { violations } from "@/domain/invariants";
import { asInvoiceId, asIsoDate, type ImportBatchId, type InvoiceId } from "@/domain/ids";
import type { ParsedBatch } from "@/domain/types";
import { unallocated } from "@/domain/balances";
import { loadSnapshot, run } from "@/server/ledger";
import { importBytes, approveSuggestion, approveCustomerHold, requestRemainder } from "@/server/flow";
import { FakeGateway } from "@/server/hitpay/fake";
import { handleWebhook, signBody } from "@/server/hitpay/webhook";
import { readEnv } from "@/server/env";
import { regexHints } from "@/server/hints/read";
import { match } from "@/domain/match";
import { fixture, freshDb, NOW } from "../helpers";

const OWNER = { kind: "human" as const, id: "owner", name: "Kim Hock" };
const SYSTEM = { kind: "system" as const, name: "test" };

function batch(id: string, amount: number, ref: string, payer: string): ParsedBatch {
  return {
    bank: "DBS",
    batchId: id as ImportBatchId,
    fileName: `${id}.csv`,
    skippedDebits: 0,
    rows: [{
      fileLine: 17,
      valueDate: asIsoDate("2026-11-17"),
      amount: cents(amount),
      rawRef: ref,
      payerName: payer,
      bankTxnId: null,
      reviewFlags: [],
    }],
  };
}

function suggest(db: ReturnType<typeof freshDb>, creditId: string) {
  const snap = loadSnapshot(db);
  const credit = snap.credits.get(creditId as never)!;
  const open = [...snap.invoices.values()]
    .filter((invoice) => invoice.status === "open" || invoice.status === "partially_paid")
    .map((invoice) => ({ id: invoice.id, customerId: invoice.customerId, remaining: invoice.remaining, issuedOn: invoice.issuedOn }));
  const hints = regexHints(credit.rawRef, new Set(open.map((invoice) => invoice.id)));
  const result = match({
    credit: { amount: credit.amount, rawRef: credit.rawRef, payerName: credit.payerName, valueDate: credit.valueDate },
    openInvoices: open,
    confirmedAliases: snap.aliases.filter((row) => row.confirmedByHuman).map((row) => ({ alias: row.alias, customerId: row.customerId, customerName: snap.customers.get(row.customerId)?.name ?? row.alias })),
    hints,
  });
  run(db, { kind: "record_suggestions", creditId: credit.id, result }, NOW);
  return [...loadSnapshot(db).allocations.values()].find((row) => row.creditId === credit.id);
}

test("P-MONEY parseSgd round-trips and does not use float addition", () => {
  expect(parseSgd("461.6")).toEqual({ ok: true, value: 46160 });
  expect(parseSgd("0.1").ok && parseSgd("0.2").ok && parseSgd("0.3").ok).toBe(true);
  const a = parseSgd("0.1");
  const b = parseSgd("0.2");
  const c = parseSgd("0.3");
  if (!a.ok || !b.ok || !c.ok) throw new Error("parse");
  expect((a.value as number) + (b.value as number)).toBe(c.value as number);
  fc.assert(fc.property(fc.integer({ min: 0, max: 50_000_000 }), (value) => {
    const parsed = parseSgd(formatSgd(cents(value)).replace("S$", ""));
    return parsed.ok && (parsed.value as number) === value;
  }));
});

test("P-I1 drops hostile hint fields and still matches the hero token", () => {
  expect(HintsSchema.safeParse({ alias: "ABC CAT", invoiceTokens: ["INV-104"], amount: 1 }).success).toBe(false);
  const db = freshDb();
  run(db, { kind: "import_batch", batch: batch("hero", 46160, "ABC CAT 104", "ABC CATERING PTE LTD"), actor: OWNER }, NOW);
  const credit = [...loadSnapshot(db).credits.values()][0]!;
  const allocation = suggest(db, credit.id);
  expect(allocation?.rule).toBe("R3");
  expect(violations(loadSnapshot(db))).toEqual([]);
});

test("P-I2 an exact match approves with nothing left unallocated", () => {
  const db = freshDb();
  run(db, { kind: "import_batch", batch: batch("exact", 18000, "INV-110", "AH SENG EATING HSE"), actor: OWNER }, NOW);
  const credit = [...loadSnapshot(db).credits.values()][0]!;
  const allocation = suggest(db, credit.id)!;
  expect(allocation.rule).toBe("R1");
  approveSuggestion(db, allocation.suggestionId, null, OWNER, NOW);
  const after = loadSnapshot(db);
  const stored = after.credits.get(credit.id)!;
  expect(unallocated(stored, [...after.allocations.values()]) as number).toBe(0);
  expect(violations(after)).toEqual([]);
});

test("P-I3 an overpayment allocates the balance and leaves the rest", () => {
  const db = freshDb();
  run(db, { kind: "import_batch", batch: batch("over", 60000, "INV-104", "ABC CATERING PTE LTD"), actor: OWNER }, NOW);
  const credit = [...loadSnapshot(db).credits.values()][0]!;
  const allocation = suggest(db, credit.id)!;
  expect(allocation.rule).toBe("R6");
  approveSuggestion(db, allocation.suggestionId, null, OWNER, NOW);
  const after = loadSnapshot(db);
  const invoice = after.invoices.get(asInvoiceId("INV-104"))!;
  expect(invoice.remaining as number).toBe(0);
  expect(unallocated(after.credits.get(credit.id)!, [...after.allocations.values()]) as number).toBe(10000);
  expect((invoice.allocated as number) + (invoice.writtenOff as number) + (invoice.remaining as number)).toBe(invoice.total as number);
  expect(violations(after)).toEqual([]);
});

test("P-I4 only a human write-off with a reason changes writtenOff", () => {
  const db = freshDb();
  const before = loadSnapshot(db).invoices.get("INV-110" as InvoiceId)!.writtenOff;
  const empty = run(db, { kind: "write_off", invoiceId: "INV-110" as InvoiceId, amount: cents(100), reason: "  ", by: OWNER }, NOW);
  expect(empty.ok).toBe(false);
  const machine = run(db, { kind: "write_off", invoiceId: "INV-110" as InvoiceId, amount: cents(100), reason: "rounding", by: SYSTEM }, NOW);
  expect(machine.ok).toBe(false);
  expect(loadSnapshot(db).invoices.get("INV-110" as InvoiceId)!.writtenOff).toBe(before);
  const written = run(db, { kind: "write_off", invoiceId: "INV-110" as InvoiceId, amount: cents(100), reason: "short crate", by: OWNER }, NOW);
  expect(written.ok).toBe(true);
  expect(loadSnapshot(db).invoices.get("INV-110" as InvoiceId)!.writtenOff as number).toBe(100);
});

test("P-I5 illegal transitions change nothing and the legal path reaches reconciled", () => {
  const db = freshDb();
  run(db, { kind: "import_batch", batch: batch("legal", 18000, "INV-110", "AH SENG"), actor: OWNER }, NOW);
  const credit = [...loadSnapshot(db).credits.values()][0]!;
  const allocation = suggest(db, credit.id)!;
  const illegal = run(db, { kind: "undo", allocationId: allocation.id, by: OWNER }, NOW);
  expect(illegal.ok).toBe(false);
  if (!illegal.ok) expect(illegal.error.code).toBe("illegal_transition");
  expect(loadSnapshot(db).audit.filter((event) => event.action === "undo")).toHaveLength(0);
  approveSuggestion(db, allocation.suggestionId, null, OWNER, NOW);
  run(db, { kind: "commit_approved", by: OWNER }, NOW);
  expect([...loadSnapshot(db).allocations.values()].find((row) => row.id === allocation.id)?.state).toBe("reconciled");
});

test("P-I6 the hero approval is audited with the bank line", async () => {
  const db = freshDb();
  await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", OWNER, NOW);
  const before = loadSnapshot(db).audit.length;
  const card = [...loadSnapshot(db).allocations.values()].find((row) => row.rule === "R3")!;
  approveSuggestion(db, card.suggestionId, null, OWNER, NOW);
  const after = loadSnapshot(db);
  expect(after.audit.length).toBeGreaterThan(before);
  const event = after.audit.find((row) => row.action === "approve");
  expect(event?.actor).toEqual(OWNER);
  expect(event?.evidence).toMatchObject({ kind: "csv_row", fileLine: 17 });
  expect(event?.before).toBeTruthy();
  expect(event?.after).toBeTruthy();
});

test("P-I7 importing a file twice is the same as importing it once", async () => {
  const once = freshDb();
  await importBytes(once, fixture("fixtures/dbs/demo.csv"), "demo.csv", OWNER, NOW);
  const twice = freshDb();
  await importBytes(twice, fixture("fixtures/dbs/demo.csv"), "demo.csv", OWNER, NOW);
  await importBytes(twice, fixture("fixtures/dbs/demo.csv"), "demo.csv", OWNER, NOW);
  expect([...loadSnapshot(twice).credits.keys()].sort()).toEqual([...loadSnapshot(once).credits.keys()].sort());
  const twins = freshDb();
  const imported = await importBytes(twins, fixture("fixtures/dbs/identical-rows.csv"), "twins.csv", OWNER, NOW);
  expect(imported.ok && imported.status).toBe("Imported 2 new, 0 already imported, 2 need review");
  const credits = [...loadSnapshot(twins).credits.values()];
  expect(credits).toHaveLength(2);
  expect(credits.every((credit) => credit.reviewFlags.includes("identical_row"))).toBe(true);
});

test("P-I8 a short payment proposes a hold and only a person sets pay-first", async () => {
  const db = freshDb();
  const gateway = new FakeGateway();
  await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", OWNER, NOW);
  expect(loadSnapshot(db).customers.get("CUS-ABC" as never)?.hold.status).toBe("normal");
  const card = [...loadSnapshot(db).allocations.values()].find((row) => row.rule === "R3")!;
  approveSuggestion(db, card.suggestionId, null, OWNER, NOW);
  expect(loadSnapshot(db).customers.get("CUS-ABC" as never)?.hold.status).toBe("proposed");
  await approveCustomerHold(db, gateway, "CUS-ABC" as never, OWNER, NOW);
  expect(loadSnapshot(db).customers.get("CUS-ABC" as never)?.hold.status).toBe("pay_first");
});

test("P-I9 and P-I10 only the pay-first webhook releases that delivery", async () => {
  const db = freshDb();
  const gateway = new FakeGateway();
  await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", OWNER, NOW);
  const card = [...loadSnapshot(db).allocations.values()].find((row) => row.rule === "R3")!;
  approveSuggestion(db, card.suggestionId, null, OWNER, NOW);
  await requestRemainder(db, gateway, "INV-104" as InvoiceId, OWNER, NOW);
  await approveCustomerHold(db, gateway, "CUS-ABC" as never, OWNER, NOW);
  const snap = loadSnapshot(db);
  const remainder = [...snap.paymentRequests.values()].find((row) => row.purpose.kind === "remainder")!;
  const payFirst = [...snap.paymentRequests.values()].find((row) => row.purpose.kind === "pay_first")!;
  const blocked = run(db, { kind: "mark_delivered", deliveryId: "DLV-201" as never, by: OWNER }, NOW);
  expect(blocked.ok).toBe(false);
  expect(loadSnapshot(db).deliveries.get("DLV-201" as never)?.status).toBe("pay_first");
  gateway.markStatus(remainder.hitpayRequestId!, "completed");
  const body = JSON.stringify({ event_type: "payment_request.completed", payment_request_id: remainder.hitpayRequestId, reference_number: "TALLY-INV-104-1", amount: "38.40", status: "completed" });
  const raw = new TextEncoder().encode(body);
  await handleWebhook(db, raw, new Headers({ "hitpay-signature": signBody(raw, readEnv().webhookSalt) }), gateway, NOW);
  expect(loadSnapshot(db).customers.get("CUS-ABC" as never)?.hold.status).toBe("pay_first");
  gateway.markStatus(payFirst.hitpayRequestId!, "completed");
  const releaseBody = JSON.stringify({ event_type: "payment_request.completed", payment_request_id: payFirst.hitpayRequestId, reference_number: "TALLY-DLV-201-1", amount: "220.00", status: "completed" });
  const releaseRaw = new TextEncoder().encode(releaseBody);
  await handleWebhook(db, releaseRaw, new Headers({ "hitpay-signature": signBody(releaseRaw, readEnv().webhookSalt) }), gateway, NOW);
  expect(loadSnapshot(db).deliveries.get("DLV-201" as never)?.status).toBe("released");
  expect(loadSnapshot(db).customers.get("CUS-ABC" as never)?.hold.status).toBe("normal");
  expect(violations(loadSnapshot(db))).toEqual([]);
});

test("P-REM the remainder is the open balance and refuses dust", () => {
  const db = freshDb();
  run(db, { kind: "import_batch", batch: batch("short", 46160, "ABC CAT 104", "ABC CATERING PTE LTD"), actor: OWNER }, NOW);
  const credit = [...loadSnapshot(db).credits.values()][0]!;
  const allocation = suggest(db, credit.id)!;
  approveSuggestion(db, allocation.suggestionId, null, OWNER, NOW);
  expect(loadSnapshot(db).invoices.get("INV-104" as InvoiceId)!.remaining as number).toBe(3840);
  const dust = run(db, { kind: "write_off", invoiceId: "INV-110" as InvoiceId, amount: cents(17980), reason: "crate missing", by: OWNER }, NOW);
  expect(dust.ok).toBe(true);
  const gateway = new FakeGateway();
  return requestRemainder(db, gateway, "INV-110" as InvoiceId, OWNER, NOW).then((result) => {
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("below_minimum");
    expect(gateway.calls).toHaveLength(0);
  });
});

test("P-C the seeded book and an approved book have no checker violations", async () => {
  expect(violations(loadSnapshot(freshDb()))).toEqual([]);
  const db = freshDb();
  await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", OWNER, NOW);
  const card = [...loadSnapshot(db).suggestions.values()].find((row) => row.body.preselected)!;
  approveSuggestion(db, card.id, null, OWNER, NOW);
  run(db, { kind: "commit_approved", by: OWNER }, NOW);
  expect(violations(loadSnapshot(db))).toEqual([]);
});
