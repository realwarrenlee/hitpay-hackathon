import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { formatAmount } from "@/domain/money";
import { violations } from "@/domain/invariants";
import { importBytes, approveSuggestion, requestRemainder, approveCustomerHold } from "@/server/flow";
import { loadSnapshot } from "@/server/ledger";
import { FakeGateway } from "@/server/hitpay/fake";
import { handleWebhook, signBody } from "@/server/hitpay/webhook";
import { readEnv } from "@/server/env";
import { customerModel, driverModel, reviewModel } from "@/server/views";
import { fixture, freshDb, NOW } from "../helpers";

const HERO = 'Ref "104" -> INV-104 (open, S$500.00). Payer "ABC CAT" -> ABC Catering (confirmed alias). No other combination of ABC Catering\'s open invoices sums to S$461.60. Amount is S$38.40 below the balance -> possible short payment.';

async function post(db: ReturnType<typeof freshDb>, gateway: FakeGateway, reference: string, amount: string, id: string, tamper = false) {
  const body = JSON.stringify({
    event_type: "payment_request.completed",
    payment_request_id: id,
    reference_number: reference,
    amount,
    status: "completed",
  });
  const raw = new TextEncoder().encode(body);
  const signature = signBody(raw, readEnv().webhookSalt);
  const sent = tamper ? new TextEncoder().encode(body.replace(amount, amount === "220.00" ? "220.01" : "38.41")) : raw;
  return handleWebhook(db, sent, new Headers({ "hitpay-signature": signature }), gateway, NOW);
}

describe("12-step demo path", () => {
  test("fake adapter walks import, approve, remainder, hold, and release", async () => {
    const db = freshDb();
    const gateway = new FakeGateway();
    const first = await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
    expect(first.ok && first.status).toBe("Imported 6 new, 0 already imported, 0 need review");
    const second = await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
    expect(second.ok && second.status).toBe("Imported 0 new, 6 already imported, 0 need review");

    const before = reviewModel(loadSnapshot(db));
    const line = before.cards.find((card) => card.fileLine === 17);
    expect(line).toMatchObject({ state: "Suggested", rule: "R3", shortfallLabel: "possible short payment S$38.40", reason: HERO });
    const approved = approveSuggestion(db, line!.suggestionId!, null, undefined, NOW);
    expect(approved.ok).toBe(true);
    const after = reviewModel(loadSnapshot(db));
    const invoice = after.invoices.find((row) => row.id === "INV-104");
    expect(invoice).toMatchObject({ status: "Partially paid", remainingLabel: "S$38.40 remaining" });
    const audit = loadSnapshot(db).audit.find((event) => event.action === "approve" && event.evidence.kind === "csv_row" && event.evidence.fileLine === 17);
    expect(audit).toBeTruthy();

    const held = customerModel(loadSnapshot(db), "CUS-ABC");
    expect(held?.hold).toBe("Hold: proposed");
    expect(held?.overdue).toBe("S$38.40");
    expect(held?.threshold).toBe("S$30.00");
    expect(held?.deliveryId).toBe("DLV-201");

    const remainder = await requestRemainder(db, gateway, "INV-104" as never, undefined, NOW);
    expect(remainder.ok).toBe(true);
    expect(gateway.calls.filter((call) => call.tool === "create_payment_request" && call.args.amount === "38.40" && call.args.reference_number === "TALLY-INV-104-1")).toHaveLength(1);

    const hold = await approveCustomerHold(db, gateway, "CUS-ABC" as never, undefined, NOW);
    expect(hold.ok).toBe(true);
    expect(customerModel(loadSnapshot(db), "CUS-ABC")?.hold).toBe("Hold: pay-first");
    expect(gateway.calls.filter((call) => call.tool === "create_payment_request" && call.args.amount === "220.00" && call.args.reference_number === "TALLY-DLV-201-1")).toHaveLength(1);

    const snap = loadSnapshot(db);
    const remainderRequest = [...snap.paymentRequests.values()].find((row) => row.referenceNumber === "TALLY-INV-104-1");
    const deliveryRequest = [...snap.paymentRequests.values()].find((row) => row.referenceNumber === "TALLY-DLV-201-1");
    expect(remainderRequest?.hitpayRequestId).toBeTruthy();
    expect(deliveryRequest?.hitpayRequestId).toBeTruthy();
    gateway.markStatus(remainderRequest!.hitpayRequestId!, "completed");
    const paid = await post(db, gateway, "TALLY-INV-104-1", "38.40", remainderRequest!.hitpayRequestId!);
    expect(paid.status).toBe(200);
    const paidBook = loadSnapshot(db);
    expect(reviewModel(paidBook).invoices.find((row) => row.id === "INV-104")?.status).toBe("Paid");
    expect(customerModel(paidBook, "CUS-ABC")?.hold).toBe("Hold: pay-first");
    expect(driverModel(paidBook, "DLV-201")?.label).toBe("Pay first: S$220.00");

    gateway.markStatus(deliveryRequest!.hitpayRequestId!, "completed");
    const tampered = await post(db, gateway, "TALLY-DLV-201-1", "220.00", deliveryRequest!.hitpayRequestId!, true);
    expect(tampered.status).toBe(401);
    expect(driverModel(loadSnapshot(db), "DLV-201")?.label).toBe("Pay first: S$220.00");

    const auditBefore = loadSnapshot(db).audit.length;
    const released = await post(db, gateway, "TALLY-DLV-201-1", "220.00", deliveryRequest!.hitpayRequestId!);
    expect(released.status).toBe(200);
    const done = loadSnapshot(db);
    expect(driverModel(done, "DLV-201")?.label).toBe("Released");
    expect(customerModel(done, "CUS-ABC")?.hold).toBe("Hold: normal");
    const auditAfter = done.audit.length;
    const replay = await post(db, gateway, "TALLY-DLV-201-1", "220.00", deliveryRequest!.hitpayRequestId!);
    expect(replay.status).toBe(200);
    expect(loadSnapshot(db).audit.length).toBe(auditAfter);
    expect(auditAfter).toBeGreaterThan(auditBefore);

    expect(violations(loadSnapshot(db))).toEqual([]);
    const dump = JSON.parse(JSON.stringify({
      invoices: [...loadSnapshot(db).invoices.values()],
      credits: [...loadSnapshot(db).credits.values()],
      deliveries: [...loadSnapshot(db).deliveries.values()],
      customers: [...loadSnapshot(db).customers.values()],
      requests: [...loadSnapshot(db).paymentRequests.values()],
      audit: loadSnapshot(db).audit,
      gateway: gateway.calls,
      amount: formatAmount(done.invoices.get("INV-104" as never)!.total),
    }));
    mkdirSync("artifacts/demo-path", { recursive: true });
    mkdirSync("evidence", { recursive: true });
    writeFileSync("artifacts/demo-path/ledger.json", JSON.stringify(dump, null, 2));
    writeFileSync("evidence/demo-path.json", JSON.stringify({ ok: true, steps: 12, violations: [] }, null, 2));
  });
});
