import { expect, test } from "vitest";
import { violations } from "@/domain/invariants";
import type { InvoiceId } from "@/domain/ids";
import { cents } from "@/domain/money";
import { loadSnapshot } from "@/server/ledger";
import { approveCustomerHold, approveSuggestion, importBytes, requestRemainder } from "@/server/flow";
import { FakeGateway } from "@/server/hitpay/fake";
import { handleWebhook, reconcilePayment, signBody } from "@/server/hitpay/webhook";
import { readEnv } from "@/server/env";
import { fixture, freshDb, NOW } from "../helpers";

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

function post(db: ReturnType<typeof freshDb>, gateway: FakeGateway, request: { hitpayRequestId: string | null; referenceNumber: string }, amount: string) {
  const body = JSON.stringify({
    event_type: "payment_request.completed",
    payment_request_id: request.hitpayRequestId,
    reference_number: request.referenceNumber,
    amount,
    status: "completed",
  });
  const raw = new TextEncoder().encode(body);
  return handleWebhook(db, raw, new Headers({ "hitpay-signature": signBody(raw, readEnv().webhookSalt) }), gateway, NOW);
}

test("a poll then a webhook replay writes one ledger change", async () => {
  const { db, gateway, request } = await ready();
  const creditsBefore = loadSnapshot(db).credits.size;
  const polled = await reconcilePayment(db, gateway, request.id, NOW);
  expect(polled.outcome).toBe("applied");
  const settled = loadSnapshot(db);
  expect(settled.invoices.get("INV-104" as InvoiceId)?.status).toBe("paid");
  expect(settled.credits.size).toBe(creditsBefore + 1);
  expect(settled.audit.some((event) => event.evidence.kind === "webhook" && event.evidence.source === "poll")).toBe(true);
  const replay = await post(db, gateway, request, "38.40");
  expect(replay.status).toBe(200);
  expect(replay.body.outcome).toBe("applied");
  const again = loadSnapshot(db);
  expect(again.audit.length).toBe(settled.audit.length);
  expect(again.credits.size).toBe(settled.credits.size);
  expect(again.audit.some((event) => event.evidence.kind === "webhook" && event.evidence.source === "webhook")).toBe(false);
  expect(violations(again)).toEqual([]);
});

test("a webhook then a poll writes one ledger change", async () => {
  const { db, gateway, request } = await ready();
  const paid = await post(db, gateway, request, "38.40");
  expect(paid.body.outcome).toBe("applied");
  const settled = loadSnapshot(db);
  expect(settled.audit.some((event) => event.evidence.kind === "webhook" && event.evidence.source === "webhook")).toBe(true);
  const polled = await reconcilePayment(db, gateway, request.id, NOW);
  expect(polled.outcome).toBe("applied");
  const again = loadSnapshot(db);
  expect(again.audit.length).toBe(settled.audit.length);
  expect(again.credits.size).toBe(settled.credits.size);
  expect(again.invoices.get("INV-104" as InvoiceId)?.status).toBe("paid");
  expect(again.audit.some((event) => event.evidence.kind === "webhook" && event.evidence.source === "poll")).toBe(false);
  expect(violations(again)).toEqual([]);
});

test("a polled amount mismatch is rejected without creating credit and can recover", async () => {
  const { db, gateway, request } = await ready();
  const before = loadSnapshot(db);
  gateway.markAmount(request.hitpayRequestId!, cents(3800));
  const polled = await reconcilePayment(db, gateway, request.id, NOW);
  expect(polled.outcome).toBe("amount_mismatch");
  const settled = loadSnapshot(db);
  expect(settled.invoices.get("INV-104" as InvoiceId)?.status).toBe("partially_paid");
  expect(settled.paymentRequests.get(request.id)?.status).toBe("pending");
  expect(settled.allocations).toEqual(before.allocations);
  expect(settled.credits).toEqual(before.credits);
  expect(settled.receipts.some((row) => row.outcome === "amount_mismatch")).toBe(true);
  const again = await reconcilePayment(db, gateway, request.id, NOW);
  expect(again.outcome).toBe("amount_mismatch");
  expect(loadSnapshot(db).audit.length).toBe(settled.audit.length);
  expect(loadSnapshot(db).credits.size).toBe(settled.credits.size);
  gateway.markAmount(request.hitpayRequestId!, cents(3840));
  expect((await reconcilePayment(db, gateway, request.id, NOW)).outcome).toBe("applied");
  expect(loadSnapshot(db).invoices.get("INV-104" as InvoiceId)?.status).toBe("paid");
});

test("a short pay-first poll does not release the delivery", async () => {
  const { db, gateway, request } = await ready();
  await post(db, gateway, request, "38.40");
  await approveCustomerHold(db, gateway, "CUS-ABC" as never, undefined, NOW);
  const delivery = [...loadSnapshot(db).paymentRequests.values()].find((row) => row.referenceNumber === "TALLY-DLV-201-1")!;
  gateway.markAmount(delivery.hitpayRequestId!, cents(1000));
  gateway.markStatus(delivery.hitpayRequestId!, "completed");
  const short = await reconcilePayment(db, gateway, delivery.id, NOW);
  expect(short.outcome).toBe("amount_mismatch");
  const settled = loadSnapshot(db);
  expect(settled.deliveries.get("DLV-201" as never)?.status).toBe("pay_first");
  expect(settled.audit.some((event) => event.action === "webhook_rejected" && (event.after as { why: string }).why === "amount_mismatch" && event.evidence.kind === "webhook" && event.evidence.source === "poll")).toBe(true);
  await reconcilePayment(db, gateway, delivery.id, NOW);
  expect(loadSnapshot(db).audit.length).toBe(settled.audit.length);
});

test("a matching pay-first poll releases the delivery through the fake gateway", async () => {
  const { db, gateway, request } = await ready();
  await post(db, gateway, request, "38.40");
  await approveCustomerHold(db, gateway, "CUS-ABC" as never, undefined, NOW);
  const delivery = [...loadSnapshot(db).paymentRequests.values()].find((row) => row.referenceNumber === "TALLY-DLV-201-1")!;
  gateway.markStatus(delivery.hitpayRequestId!, "completed");
  const released = await reconcilePayment(db, gateway, delivery.id, NOW);
  expect(released.outcome).toBe("applied");
  expect(loadSnapshot(db).deliveries.get("DLV-201" as never)?.status).toBe("released");
  expect(gateway.calls.some((call) => call.tool === "get_payment_request")).toBe(true);
});
