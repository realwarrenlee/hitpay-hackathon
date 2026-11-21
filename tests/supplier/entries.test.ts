import { mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import fc from "fast-check";
import { InvoiceEntry, DeliveryEntry, validCalendarDate } from "@/domain/entry";
import { cents, formatAmount } from "@/domain/money";
import { loadSnapshot, run } from "@/server/ledger";
import { openDatabase } from "@/server/db";
import { violations } from "@/domain/invariants";
import { deliveryDetail, deliveryList } from "@/server/deliveries";
import { NOW } from "../helpers";
import { supplierDb, invoiceInput, deliveryInput, operator } from "./helpers";

test.each(["", "0", "-1", "NaN", "1.001", "1e2", "90071992547409.92"])(
  "invalid SGD %s cannot enter invoice or delivery",
  (amount) => {
    expect(InvoiceEntry.safeParse({ ...invoiceInput, amount }).success).toBe(
      false,
    );
    expect(DeliveryEntry.safeParse({ ...deliveryInput, amount }).success).toBe(
      false,
    );
    const db = supplierDb();
    const before = loadSnapshot(db);
    expect(
      run(
        db,
        {
          kind: "create_invoice",
          input: { ...invoiceInput, amount },
          by: operator,
        },
        NOW,
      ).ok,
    ).toBe(false);
    expect(
      run(
        db,
        {
          kind: "create_delivery",
          input: { ...deliveryInput, amount },
          by: operator,
        },
        NOW,
      ).ok,
    ).toBe(false);
    expect(loadSnapshot(db)).toEqual(before);
    db.close();
  },
);

test.each([
  "",
  "2026-02-29",
  "2026-02-30",
  "2026-13-01",
  "0000-01-01",
  "2026-1-01",
  "99999-01-01",
])("invalid calendar date %s is rejected at the ledger boundary", (date) => {
  expect(validCalendarDate(date)).toBe(false);
  const db = supplierDb();
  expect(
    run(
      db,
      {
        kind: "create_invoice",
        input: { ...invoiceInput, dueOn: date },
        by: operator,
      },
      NOW,
    ).ok,
  ).toBe(false);
  expect(
    run(
      db,
      {
        kind: "create_delivery",
        input: { ...deliveryInput, scheduledFor: date },
        by: operator,
      },
      NOW,
    ).ok,
  ).toBe(false);
  expect(loadSnapshot(db).audit).toHaveLength(1);
  db.close();
});

test("positive exact-cent amounts round trip, creation is audited and repeated submissions do not duplicate", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 10000000 }), (amount) => {
      const db = supplierDb();
      const invoice = { ...invoiceInput, amount: formatAmount(cents(amount)) };
      const delivery = {
        ...deliveryInput,
        amount: formatAmount(cents(amount)),
      };
      expect(
        run(db, { kind: "create_invoice", input: invoice, by: operator }, NOW)
          .ok,
      ).toBe(true);
      expect(
        run(db, { kind: "create_delivery", input: delivery, by: operator }, NOW)
          .ok,
      ).toBe(true);
      const before = loadSnapshot(db);
      expect(before.invoices.get("INV-9001" as never)!.remaining).toBe(amount);
      expect(before.deliveries.get("DLV-9001" as never)!.amount).toBe(amount);
      expect(before.deliveries.get("DLV-9001" as never)!.status).toBe(
        "on_credit",
      );
      expect(before.customers.get("CUS-AHS" as never)!.hold.status).toBe(
        "normal",
      );
      expect(before.paymentRequests.size).toBe(0);
      expect(before.audit.map((event) => event.action)).toEqual([
        "seeded",
        "invoice_created",
        "delivery_created",
      ]);
      expect(
        run(db, { kind: "create_invoice", input: invoice, by: operator }, NOW),
      ).toMatchObject({ ok: true, value: { info: { existing: 1 } } });
      expect(
        run(
          db,
          { kind: "create_delivery", input: delivery, by: operator },
          NOW,
        ),
      ).toMatchObject({ ok: true, value: { info: { existing: 1 } } });
      expect(loadSnapshot(db)).toEqual(before);
      expect(violations(before)).toEqual([]);
      db.close();
    }),
    { numRuns: 100 },
  );
});

test("conflicting references, unknown customers, forged actors and unagreed due dates cannot alter records", () => {
  const db = supplierDb();
  for (const [kind, input] of [
    ["create_invoice", invoiceInput],
    ["create_delivery", deliveryInput],
  ] as const) {
    expect(run(db, { kind, input, by: operator }, NOW).ok).toBe(true);
    const before = loadSnapshot(db);
    for (const change of [{ amount: "1.00" }, { customerId: "CUS-TBK" }]) {
      expect(
        run(db, { kind, input: { ...input, ...change }, by: operator }, NOW),
      ).toMatchObject({ ok: false, error: { code: "duplicate" } });
      expect(loadSnapshot(db)).toEqual(before);
    }
    expect(
      run(
        db,
        {
          kind,
          input: {
            ...input,
            id: kind === "create_invoice" ? "INV-9002" : "DLV-9002",
            customerId: "CUS-NOPE",
          },
          by: operator,
        },
        NOW,
      ),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(
      run(db, { kind, input, by: { kind: "ai" } as never }, NOW),
    ).toMatchObject({ ok: false, error: { code: "wrong_actor" } });
    expect(loadSnapshot(db)).toEqual(before);
  }
  expect(
    run(
      db,
      {
        kind: "create_invoice",
        input: { ...invoiceInput, id: "INV-9002", dueOn: "2026-10-01" },
        by: operator,
      },
      NOW,
    ).ok,
  ).toBe(false);
  const { dueOn: omittedDueDate, ...missingDueDate } = invoiceInput;
  expect(omittedDueDate).toBe("2026-11-16");
  const beforeMissing = loadSnapshot(db);
  expect(
    run(
      db,
      {
        kind: "create_invoice",
        input: { ...missingDueDate, id: "INV-9002" },
        by: operator,
      },
      NOW,
    ),
  ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  expect(loadSnapshot(db)).toEqual(beforeMissing);
  db.close();
});

test("new invoice and delivery persist across a fresh backend process with correct customer linkage", () => {
  const file = join(
    mkdtempSync(join(tmpdir(), "tally-supplier-persist-")),
    "ledger.db",
  );
  let db = supplierDb(file);
  run(db, { kind: "create_invoice", input: invoiceInput, by: operator }, NOW);
  run(db, { kind: "create_delivery", input: deliveryInput, by: operator }, NOW);
  const before = loadSnapshot(db);
  db.close();
  const code =
    "const {getDb,loadSnapshot}=require('./src/server/ledger.ts');const d=getDb(),s=loadSnapshot(d);process.stdout.write(JSON.stringify({invoices:[...s.invoices.values()],deliveries:[...s.deliveries.values()],audit:s.audit}));d.close();";
  const result = JSON.parse(
    execFileSync(process.execPath, ["--require", "tsx/cjs", "-e", code], {
      encoding: "utf8",
      env: {
        ...process.env,
        TALLY_DB_URL: file,
        TALLY_GATEWAY: "fake",
        HINTS_API_KEY: "",
      },
    }),
  );
  expect(result).toEqual({
    invoices: [...before.invoices.values()],
    deliveries: [...before.deliveries.values()],
    audit: before.audit,
  });
  db = openDatabase(file);
  expect(violations(loadSnapshot(db))).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({
    integrity_check: "ok",
  });
  db.close();
});

test("entry audit failure rolls back invoice/delivery, projections and sequence", () => {
  const db = supplierDb();
  const before = loadSnapshot(db);
  db.exec(
    "CREATE TRIGGER fail_entry_audit BEFORE INSERT ON audit_event BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  expect(() =>
    run(db, { kind: "create_invoice", input: invoiceInput, by: operator }, NOW),
  ).toThrow("fixture failure");
  expect(() =>
    run(
      db,
      { kind: "create_delivery", input: deliveryInput, by: operator },
      NOW,
    ),
  ).toThrow("fixture failure");
  expect(loadSnapshot(db)).toEqual(before);
  db.close();
});

test("Today/Tomorrow/upcoming filters use policy date and link balances to the correct customer", () => {
  const db = supplierDb();
  run(db, { kind: "create_invoice", input: invoiceInput, by: operator }, NOW);
  for (const [id, date] of [
    ["DLV-9001", "2026-11-17"],
    ["DLV-9002", "2026-11-18"],
    ["DLV-9003", "2026-11-16"],
  ])
    run(
      db,
      {
        kind: "create_delivery",
        input: { ...deliveryInput, id, scheduledFor: date },
        by: operator,
      },
      NOW,
    );
  run(
    db,
    {
      kind: "create_delivery",
      input: { ...deliveryInput, id: "DLV-9004", customerId: "CUS-TBK" },
      by: operator,
    },
    NOW,
  );
  const s = loadSnapshot(db);
  expect(deliveryList(s, "today").map((row) => row.delivery.id)).toEqual([
    "DLV-9001",
  ]);
  expect(deliveryList(s, "tomorrow").map((row) => row.delivery.id)).toEqual([
    "DLV-9002",
    "DLV-9004",
  ]);
  expect(deliveryList(s).map((row) => row.delivery.id)).toEqual([
    "DLV-9001",
    "DLV-9002",
    "DLV-9004",
  ]);
  expect(deliveryDetail(s, "DLV-9001")!.balances.overdue).toBe(3840);
  expect(deliveryDetail(s, "DLV-9004")!.balances.outstanding).toBe(0);
  expect(deliveryDetail(s, "DLV-9002")!.canEvaluate).toBe(false);
  expect(deliveryDetail(s, "DLV-9002")!.nextAction).toContain("DLV-9001");
  expect(
    run(
      db,
      {
        kind: "check_cutoff",
        customerId: "CUS-AHS" as never,
        expectedDeliveryId: "DLV-9002" as never,
        by: operator,
      },
      NOW,
    ).ok,
  ).toBe(false);
  expect(loadSnapshot(db)).toEqual(s);
  db.close();
});
