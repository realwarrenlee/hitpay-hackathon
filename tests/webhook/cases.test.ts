import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { violations } from "@/domain/invariants";
import type { InvoiceId } from "@/domain/ids";
import { loadSnapshot } from "@/server/ledger";
import { approveCustomerHold, approveSuggestion, importBytes, requestRemainder } from "@/server/flow";
import { FakeGateway } from "@/server/hitpay/fake";
import { handleWebhook, signBody } from "@/server/hitpay/webhook";
import { readEnv } from "@/server/env";
import { fixture, freshDb, NOW } from "../helpers";

function signed(body: string, salt = readEnv().webhookSalt) {
  const raw = new TextEncoder().encode(body);
  return { raw, signature: signBody(raw, salt) };
}

async function ready() {
  const db = freshDb();
  const gateway = new FakeGateway();
  await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
  const card = [...loadSnapshot(db).allocations.values()].find((row) => row.rule === "R3")!;
  approveSuggestion(db, card.suggestionId, null, undefined, NOW);
  await requestRemainder(db, gateway, "INV-104" as InvoiceId, undefined, NOW);
  const request = [...loadSnapshot(db).paymentRequests.values()].find((row) => row.referenceNumber === "TALLY-INV-104-1")!;
  gateway.markStatus(request.hitpayRequestId!, "completed");
  return { db, gateway, request };
}

test("valid remainder webhook pays the invoice", async () => {
  const { db, gateway, request } = await ready();
  const body = JSON.stringify({ event_type: "payment_request.completed", payment_request_id: request.hitpayRequestId, reference_number: "TALLY-INV-104-1", amount: "38.40", status: "completed" });
  const { raw, signature } = signed(body);
  const result = await handleWebhook(db, raw, new Headers({ "hitpay-signature": signature }), gateway, NOW);
  expect(result.status).toBe(200);
  expect(loadSnapshot(db).invoices.get("INV-104" as InvoiceId)?.status).toBe("paid");
  expect(violations(loadSnapshot(db))).toEqual([]);
});

test("tampered amount and a bad signature are rejected", async () => {
  const { db, gateway, request } = await ready();
  const body = JSON.stringify({ event_type: "payment_request.completed", payment_request_id: request.hitpayRequestId, reference_number: "TALLY-INV-104-1", amount: "38.40", status: "completed" });
  const { signature } = signed(body);
  const tampered = new TextEncoder().encode(body.replace("38.40", "38.41"));
  const result = await handleWebhook(db, tampered, new Headers({ "hitpay-signature": signature }), gateway, NOW);
  expect(result.status).toBe(401);
  expect(loadSnapshot(db).invoices.get("INV-104" as InvoiceId)?.status).toBe("partially_paid");
});

test("a 63-character signature does not throw", async () => {
  const { db, gateway } = await ready();
  const result = await handleWebhook(db, new TextEncoder().encode("{}"), new Headers({ "hitpay-signature": "a".repeat(63) }), gateway, NOW);
  expect(result.status).toBe(401);
});

test("a missing signature is a 401", async () => {
  const { db, gateway } = await ready();
  const result = await handleWebhook(db, new TextEncoder().encode("{}"), new Headers(), gateway, NOW);
  expect(result.status).toBe(401);
});

test("replay does not add an audit row", async () => {
  const { db, gateway, request } = await ready();
  const body = JSON.stringify({ event_type: "payment_request.completed", payment_request_id: request.hitpayRequestId, reference_number: "TALLY-INV-104-1", amount: "38.40", status: "completed" });
  const { raw, signature } = signed(body);
  await handleWebhook(db, raw, new Headers({ "hitpay-signature": signature }), gateway, NOW);
  const count = loadSnapshot(db).audit.length;
  const again = await handleWebhook(db, raw, new Headers({ "hitpay-signature": signature }), gateway, NOW);
  expect(again.status).toBe(200);
  expect(loadSnapshot(db).audit.length).toBe(count);
});

test("a request that is not completed leaves the ledger alone", async () => {
  const { db, gateway, request } = await ready();
  gateway.markStatus(request.hitpayRequestId!, "pending");
  const body = JSON.stringify({ event_type: "payment_request.completed", payment_request_id: request.hitpayRequestId, reference_number: "TALLY-INV-104-1", amount: "38.40", status: "completed" });
  const { raw, signature } = signed(body);
  const result = await handleWebhook(db, raw, new Headers({ "hitpay-signature": signature }), gateway, NOW);
  expect(result.status).toBe(200);
  expect(result.body.outcome).toBe("not_completed");
  expect(loadSnapshot(db).invoices.get("INV-104" as InvoiceId)?.status).toBe("partially_paid");
});

test("an unknown reference is recorded and changes no invoice", async () => {
  const { db, gateway } = await ready();
  gateway.put("pr_unknown", 1000 as never, "TALLY-NOPE", "completed");
  const body = JSON.stringify({ event_type: "payment_request.completed", payment_request_id: "pr_unknown", reference_number: "TALLY-NOPE", amount: "10.00", status: "completed" });
  const { raw, signature } = signed(body);
  const result = await handleWebhook(db, raw, new Headers({ "hitpay-signature": signature }), gateway, NOW);
  expect(result.status).toBe(200);
  expect(result.body.outcome).toBe("unknown_reference");
  expect(loadSnapshot(db).invoices.get("INV-104" as InvoiceId)?.status).toBe("partially_paid");
});

test("a signed amount mismatch is rejected without creating a suggested allocation", async () => {
  const { db, gateway, request } = await ready();
  const before = loadSnapshot(db);
  const body = JSON.stringify({ event_type: "payment_request.completed", payment_request_id: request.hitpayRequestId, reference_number: "TALLY-INV-104-1", amount: "38.00", status: "completed" });
  const { raw, signature } = signed(body);
  const result = await handleWebhook(db, raw, new Headers({ "hitpay-signature": signature }), gateway, NOW);
  expect(result.status).toBe(200);
  expect(result.body.outcome).toBe("amount_mismatch");
  const snap = loadSnapshot(db);
  expect(snap.invoices.get("INV-104" as InvoiceId)?.status).toBe("partially_paid");
  expect(snap.allocations).toEqual(before.allocations);
  expect(snap.credits).toEqual(before.credits);
  expect(snap.deliveries).toEqual(before.deliveries);
});

test("a remainder during a pay-first hold does not lift the hold", async () => {
  const { db, gateway, request } = await ready();
  await approveCustomerHold(db, gateway, "CUS-ABC" as never, undefined, NOW);
  const body = JSON.stringify({ event_type: "payment_request.completed", payment_request_id: request.hitpayRequestId, reference_number: "TALLY-INV-104-1", amount: "38.40", status: "completed" });
  const { raw, signature } = signed(body);
  await handleWebhook(db, raw, new Headers({ "hitpay-signature": signature }), gateway, NOW);
  const snap = loadSnapshot(db);
  expect(snap.invoices.get("INV-104" as InvoiceId)?.status).toBe("paid");
  expect(snap.customers.get("CUS-ABC" as never)?.hold.status).toBe("pay_first");
});

test("a pay-first webhook releases the delivery", async () => {
  const { db, gateway, request } = await ready();
  await approveCustomerHold(db, gateway, "CUS-ABC" as never, undefined, NOW);
  const paid = JSON.stringify({ event_type: "payment_request.completed", payment_request_id: request.hitpayRequestId, reference_number: "TALLY-INV-104-1", amount: "38.40", status: "completed" });
  const paidRaw = signed(paid);
  await handleWebhook(db, paidRaw.raw, new Headers({ "hitpay-signature": paidRaw.signature }), gateway, NOW);
  const delivery = [...loadSnapshot(db).paymentRequests.values()].find((row) => row.referenceNumber === "TALLY-DLV-201-1")!;
  gateway.markStatus(delivery.hitpayRequestId!, "completed");
  const body = JSON.stringify({ event_type: "payment_request.completed", payment_request_id: delivery.hitpayRequestId, reference_number: "TALLY-DLV-201-1", amount: "220.00", status: "completed" });
  const { raw, signature } = signed(body);
  const credits = loadSnapshot(db).credits.size;
  const result = await handleWebhook(db, raw, new Headers({ "hitpay-signature": signature }), gateway, NOW);
  expect(result.status).toBe(200);
  expect(loadSnapshot(db).deliveries.get("DLV-201" as never)?.status).toBe("released");
  expect(loadSnapshot(db).customers.get("CUS-ABC" as never)?.hold.status).toBe("normal");
  expect(loadSnapshot(db).credits.size).toBe(credits);
});

test("the route reads raw bytes", () => {
  const source = readFileSync("src/app/api/hitpay/webhook/route.ts", "utf8");
  expect(source).toContain("arrayBuffer");
  expect(source).not.toContain("request.json");
  expect(source).not.toContain("request.text");
});
