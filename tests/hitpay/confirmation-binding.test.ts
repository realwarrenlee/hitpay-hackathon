import { expect, test, vi } from "vitest";
import { cents, formatAmount } from "@/domain/money";
import { violations } from "@/domain/invariants";
import { loadSnapshot, run } from "@/server/ledger";
import { approveCustomerHold, checkCutoff, requestRemainder } from "@/server/flow";
import { FakeGateway } from "@/server/hitpay/fake";
import { handleWebhook, reconcilePayment, signBody } from "@/server/hitpay/webhook";
import { readEnv } from "@/server/env";
import { freshDb, NOW } from "../helpers";

async function setup(payFirst = false) {
  const db = freshDb();
  const gateway = new FakeGateway();
  if (payFirst) {
    checkCutoff(db, "CUS-ABC" as never, undefined, NOW);
    expect((await approveCustomerHold(db, gateway, "CUS-ABC" as never, undefined, NOW)).ok).toBe(true);
  } else expect((await requestRemainder(db, gateway, "INV-104" as never, undefined, NOW)).ok).toBe(true);
  const request = [...loadSnapshot(db).paymentRequests.values()][0];
  gateway.markStatus(request.hitpayRequestId!, "completed");
  const remote = await gateway.getPaymentRequest(request.hitpayRequestId!);
  if (!remote.ok) throw Error("Missing test payment");
  return { db, gateway, request, remote: remote.value };
}

async function post(x: Awaited<ReturnType<typeof setup>>, fields: Record<string, unknown> = {}) {
  const raw = new TextEncoder().encode(JSON.stringify({ payment_request_id: x.request.hitpayRequestId,
    reference_number: x.request.referenceNumber, amount: formatAmount(x.request.amount),
    currency: "SGD", status: "completed", event_type: "payment_request.completed", ...fields }));
  return handleWebhook(x.db, raw, new Headers({ "hitpay-signature": signBody(raw, readEnv().webhookSalt) }), x.gateway, NOW);
}

test.each([false, true])("webhook and poll reject remote identity/currency/purpose/amount/reference and allow correction (pay-first %s)", async (payFirst) => {
  const x = await setup(payFirst);
  const original = x.gateway.getPaymentRequest.bind(x.gateway);
  const before = loadSnapshot(x.db);
  for (const [field, value, outcome] of [
    ["id", "wrong-id", "identity_mismatch"], ["currency", "USD", "currency_mismatch"],
    ["currency", null, "currency_mismatch"], ["purpose", "unrelated", "purpose_mismatch"],
    ["purpose", null, "purpose_mismatch"], ["amount", cents(1234), "amount_mismatch"],
    ["referenceNumber", "wrong-reference", "unknown_reference"],
  ] as const) {
    const spy = vi.spyOn(x.gateway, "getPaymentRequest").mockResolvedValue({ ok: true, value: { ...x.remote, [field]: value } });
    expect((await post(x)).body.outcome).toBe(outcome);
    expect((await reconcilePayment(x.db, x.gateway, x.request.id, NOW)).outcome).toBe(outcome);
    const after = loadSnapshot(x.db);
    expect(after.invoices).toEqual(before.invoices);
    expect(after.credits).toEqual(before.credits);
    expect(after.allocations).toEqual(before.allocations);
    expect(after.deliveries).toEqual(before.deliveries);
    expect(after.customers).toEqual(before.customers);
    expect(after.paymentRequests).toEqual(before.paymentRequests);
    spy.mockRestore();
  }
  x.gateway.getPaymentRequest = original;
  expect((await post(x)).body.outcome).toBe("applied");
  const paid = loadSnapshot(x.db);
  if (payFirst) {
    expect(paid.deliveries.get("DLV-201" as never)!.status).toBe("released");
    expect(paid.invoices.get("INV-104" as never)!.remaining).toBe(50000);
  } else expect(paid.invoices.get("INV-104" as never)!.remaining).toBe(0);
  expect((await reconcilePayment(x.db, x.gateway, x.request.id, NOW)).outcome).toBe("applied");
  expect(loadSnapshot(x.db)).toEqual(paid);
  expect(violations(paid)).toEqual([]);
  x.db.close();
});

test.each([{ amount: "1.00" }, { currency: "USD" }, { purpose: "unrelated" }, { status: "pending" }, { event_type: "charge.created" }])("signed event mismatch %j cannot consume a valid confirmation", async (fields) => {
  const x = await setup(true);
  const before = loadSnapshot(x.db);
  expect((await post(x, fields)).body.outcome).not.toBe("applied");
  expect(loadSnapshot(x.db).deliveries).toEqual(before.deliveries);
  expect(loadSnapshot(x.db).credits).toEqual(before.credits);
  expect(loadSnapshot(x.db).audit.slice(before.audit.length).some((event) => event.action === "webhook_rejected")).toBe(true);
  expect((await post(x)).body.outcome).toBe("applied");
  expect(loadSnapshot(x.db).deliveries.get("DLV-201" as never)!.status).toBe("released");
  x.db.close();
});

test("a different completed request cannot use the local reference", async () => {
  const x = await setup();
  x.gateway.put("foreign", x.request.amount, x.request.referenceNumber, "completed");
  const before = loadSnapshot(x.db);
  expect((await post(x, { payment_request_id: "foreign" })).body.outcome).toBe("identity_mismatch");
  expect(loadSnapshot(x.db).credits).toEqual(before.credits);
  expect(loadSnapshot(x.db).audit.slice(before.audit.length).some((event) => event.action === "webhook_rejected")).toBe(true);
  expect((await post(x)).body.outcome).toBe("applied");
  x.db.close();
});

test("transaction boundary also rejects a forged request identity", async () => {
  const x = await setup(true);
  const before = loadSnapshot(x.db);
  const result = run(x.db, { kind: "webhook_confirmed", event: { receiptId: "forged" as never, hitpayRequestId: "foreign" as never,
    referenceNumber: x.request.referenceNumber, amountPaid: x.request.amount, paidAt: NOW, source: "poll" } }, NOW);
  expect(result.ok && result.value.info.outcome).toBe("identity_mismatch");
  expect(loadSnapshot(x.db).deliveries).toEqual(before.deliveries);
  expect(loadSnapshot(x.db).credits).toEqual(before.credits);
  x.db.close();
});

test("a changed invoice remainder still requires human review and deduplicates the confirmed payment", async () => {
  const x = await setup();
  expect(run(x.db, { kind: "write_off", invoiceId: "INV-104" as never, amount: cents(10000), by: { kind: "human", name: "Test owner" }, reason: "Agreed fictional adjustment" }, NOW).ok).toBe(true);
  expect((await post(x)).body.outcome).toBe("amount_mismatch");
  const reviewed = loadSnapshot(x.db);
  expect(reviewed.invoices.get("INV-104" as never)!.remaining).toBe(40000);
  expect([...reviewed.credits.values()][0].unallocated).toBe(50000);
  expect([...reviewed.allocations.values()][0].state).toBe("suggested");
  expect((await reconcilePayment(x.db, x.gateway, x.request.id, NOW)).outcome).toBe("amount_mismatch");
  expect(loadSnapshot(x.db)).toEqual(reviewed);
  expect(violations(reviewed)).toEqual([]);
  x.db.close();
});

test("ambiguous gateway creation failure remains visible and blocks duplicate remainder requests", async () => {
  const db = freshDb();
  const gateway = new FakeGateway();
  vi.spyOn(gateway, "createPaymentRequest").mockResolvedValue({ ok: false, error: { code: "transport", detail: "Simulated timeout" } });
  const result = await requestRemainder(db, gateway, "INV-104" as never, undefined, NOW);
  expect(result).toMatchObject({ ok: false, error: { code: "request_unresolved" } });
  const before = loadSnapshot(db);
  expect([...before.paymentRequests.values()][0].status).toBe("creating");
  expect((await requestRemainder(db, gateway, "INV-104" as never, undefined, NOW))).toMatchObject({ ok: false, error: { code: "request_unresolved" } });
  expect(gateway.createPaymentRequest).toHaveBeenCalledTimes(1);
  expect(loadSnapshot(db)).toEqual(before);
  db.close();
});
