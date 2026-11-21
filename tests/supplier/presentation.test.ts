import { expect, test } from "vitest";
import {
  actionLabel,
  activityReason,
  displayReason,
  formatDate,
  formatTime,
  newestActivity,
  plural,
} from "@/lib/presentation";
import { reviewModel } from "@/server/views";
import { pendingWork } from "@/server/work-queue";
import { freshDb, NOW } from "../helpers";
import { loadSnapshot, run } from "@/server/ledger";
import { cents } from "@/domain/money";
import type { AuditEvent } from "@/domain/types";
import { operator as by, supplierDb, deliveryInput } from "./helpers";
test("shared date, time, plural and matching language stay readable without rewriting recorded evidence", () => {
  expect(formatDate("2026-11-17")).toBe("17 Nov 2026");
  expect(formatDate("2026-11-16T18:00:00Z")).toBe("17 Nov 2026");
  expect(formatTime("2026-11-17T02:00:00Z").toLowerCase()).toBe("10:00 am");
  expect(formatDate("invalid")).toBe("Date unavailable");
  expect(formatTime("invalid")).toBe("Time unavailable");
  expect([
    plural(0, "invoice"),
    plural(1, "invoice"),
    plural(2, "invoice"),
  ]).toEqual(["0 invoices", "1 invoice", "2 invoices"]);
  const raw = "Ref -> INV-104. possible short payment.";
  expect(displayReason(raw)).toContain("partial payment");
  expect(raw).toBe("Ref -> INV-104. possible short payment.");
  expect(displayReason("Exact amount, pre-ticked.")).toContain(
    "Human approval is required",
  );
  expect(actionLabel("approve")).toBe("Allocation approved");
});
test("activity chronology compares instants and numeric IDs for equal timestamps without changing stored order or data", () => {
  const base: AuditEvent = {
    id: "AUD-9999",
    at: NOW,
    actor: by,
    entity: "allocation",
    entityId: "ALC-1",
    action: "approve",
    before: { state: "suggested" },
    after: { state: "approved" },
    evidence: { kind: "human_reason", reason: "Full recorded reason" },
  };
  const events = [
    base,
    { ...base, id: "AUD-10000" },
    { ...base, id: "AUD-1", at: "2026-11-17T03:00:00Z" as never },
  ];
  const copy = structuredClone(events);
  expect(newestActivity(events).map((e) => e.id)).toEqual([
    "AUD-1",
    "AUD-10000",
    "AUD-9999",
  ]);
  expect(events).toEqual(copy);
  expect(activityReason(base)).toBe("Full recorded reason");
  for (const reason of ["rejected", "undo", "approve hold", "confirmed"])
    expect(activityReason({ ...base, evidence: { kind: "human_reason", reason } })).toBeNull();
  expect(activityReason({ ...base, action: "override_hold", evidence: { kind: "human_reason", reason: "Agreed credit extension to Friday" } })).toBe("Agreed credit extension to Friday");
});
test("unallocated verified receipts remain visible in Review even with no suggested invoice", () => {
  const db = freshDb();
  try {
    const s = loadSnapshot(db);
    s.credits.set("CRD-RECEIPT" as never, {
      id: "CRD-RECEIPT" as never,
      source: {
        kind: "hitpay_webhook",
        receiptId: "REC-1" as never,
        paymentRequestId: "PRQ-1" as never,
      },
      dedupeKey: "receipt" as never,
      valueDate: s.today,
      amount: cents(100),
      unallocated: cents(100),
      payerName: "Fictional payer",
      rawRef: "Receipt 1",
      reviewFlags: [],
    });
    const model = reviewModel(s);
    expect(model.cards).toHaveLength(1);
    expect(model.cards[0]).toMatchObject({
      state: "Unmatched",
      valid: false,
      unallocated: 100,
    });
    expect(model.cards[0].reason).toContain("Verified receipt");
    expect(pendingWork(s).credits).toHaveLength(1);
  } finally {
    db.close();
  }
});
test("Overview counts actual current delivery work; an unchanged completed evaluation is not a pending task", () => {
  const db = supplierDb();
  try {
    expect(
      run(db, { kind: "create_delivery", input: deliveryInput, by }, NOW).ok,
    ).toBe(true);
    const before = loadSnapshot(db);
    expect(pendingWork(before).evaluations).toHaveLength(1);
    expect(
      run(db, { kind: "check_cutoff", customerId: "all", by }, NOW).ok,
    ).toBe(true);
    const checked = loadSnapshot(db);
    expect(pendingWork(checked).evaluations).toHaveLength(0);
    expect(pendingWork(checked).proposals).toHaveLength(0);
    expect(pendingWork(checked).awaitingPayment).toHaveLength(0);
    checked.policyVersion += 1;
    expect(pendingWork(checked).evaluations).toHaveLength(1);
  } finally {
    db.close();
  }
});
