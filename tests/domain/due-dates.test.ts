import { expect, test } from "vitest";
import { overdueBalance } from "@/domain/balances";
import { asIsoDate } from "@/domain/ids";
import { cents } from "@/domain/money";
import { decide } from "@/domain/decide";
import { loadSnapshot } from "@/server/ledger";
import { freshDb, NOW } from "../helpers";

test.each([
  ["2026-11-16", null, 0], ["2026-11-17", null, 0], ["2026-11-18", null, 3840],
  ["2026-11-18", 1, 0], ["2026-11-19", 1, 3840],
])("due date boundary on %s with %s grace days", (today, grace, expected) => {
  const db = freshDb();
  const s = loadSnapshot(db);
  const invoice = s.invoices.get("INV-104" as never)!;
  invoice.issuedOn = asIsoDate("2026-10-17");
  invoice.dueOn = asIsoDate("2026-11-17");
  const balance = { allocated: cents(46160), writtenOff: cents(0), remaining: cents(3840), status: "partially_paid" as const };
  expect(overdueBalance([{ invoice, balance }], { overdueBalanceThreshold: cents(3000), overdueDaysThreshold: grace }, asIsoDate(today))).toBe(expected);
  invoice.dueOn = null;
  expect(overdueBalance([{ invoice, balance }], s.settings, asIsoDate(today))).toBe(0);
  db.close();
});

test("within-terms and unknown invoices remain outstanding but never propose overdue holds", () => {
  const db = freshDb();
  const s = loadSnapshot(db);
  const invoice = s.invoices.get("INV-104" as never)!;
  invoice.issuedOn = asIsoDate("2026-11-01");
  s.today = asIsoDate("2026-11-25");
  s.deliveries.get("DLV-201" as never)!.scheduledFor = s.today;
  for (const due of [asIsoDate("2026-12-01"), null]) {
    invoice.dueOn = due;
    const result = decide(s, { kind: "check_cutoff", customerId: invoice.customerId, by: { kind: "system" } }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.error.code);
    expect(result.value.snapshot.customers.get(invoice.customerId)!.hold.status).toBe("normal");
    expect(result.value.snapshot.invoices.get(invoice.id)!.remaining).toBe(50000);
  }
  invoice.dueOn = asIsoDate("2026-11-24");
  const result = decide(s, { kind: "check_cutoff", customerId: invoice.customerId, by: { kind: "system" } }, NOW);
  expect(result.ok && result.value.snapshot.customers.get(invoice.customerId)!.hold.status).toBe("proposed");
  db.close();
});
