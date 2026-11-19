import { describe, expect, test } from "vitest";
import { cents } from "@/domain/money";
import { asInvoiceId, asIsoDate, type CustomerId } from "@/domain/ids";
import { match } from "@/domain/match";
import { regexHints } from "@/server/hints/read";
import { freshDb, fixture, NOW } from "../helpers";
import { importBytes } from "@/server/flow";
import { loadSnapshot } from "@/server/ledger";
import { reviewModel } from "@/server/views";

const HERO = 'Ref "104" -> INV-104 (open, S$500.00). Payer "ABC CAT" -> ABC Catering (confirmed alias). No other combination of ABC Catering\'s open invoices sums to S$461.60. Amount is S$38.40 below the balance -> possible short payment.';

test("P-R5 amount alone is choose_one and an exact token is R1", () => {
  const open = [
    { id: asInvoiceId("INV-104"), customerId: "CUS-ABC" as CustomerId, remaining: cents(50000), issuedOn: asIsoDate("2026-10-28") },
    { id: asInvoiceId("INV-105"), customerId: "CUS-AHS" as CustomerId, remaining: cents(50000), issuedOn: asIsoDate("2026-10-30") },
  ];
  const ambiguous = match({
    credit: { amount: cents(50000), rawRef: "", payerName: "OTHR TRF", valueDate: asIsoDate("2026-11-17") },
    openInvoices: open,
    confirmedAliases: [],
    hints: { alias: null, invoiceTokens: [] },
  });
  expect(ambiguous.kind).toBe("suggested");
  if (ambiguous.kind === "suggested") {
    expect(ambiguous.suggestion.rule).toBe("R5");
    expect(ambiguous.suggestion.tier).toBe("C");
    expect(ambiguous.suggestion.preselected).toBe(false);
  }
  const exact = match({
    credit: { amount: cents(18000), rawRef: "INV-110", payerName: "AH SENG EATING HSE", valueDate: asIsoDate("2026-11-17") },
    openInvoices: [{ id: asInvoiceId("INV-110"), customerId: "CUS-AHS" as CustomerId, remaining: cents(18000), issuedOn: asIsoDate("2026-11-05") }],
    confirmedAliases: [],
    hints: regexHints("INV-110", new Set(["INV-110"])),
  });
  expect(exact.kind).toBe("suggested");
  if (exact.kind === "suggested") {
    expect(exact.suggestion.rule).toBe("R1");
    expect(exact.suggestion.tier).toBe("A");
    expect(exact.suggestion.preselected).toBe(true);
  }
});

test("P-R4 returns a split only for one exact subset", () => {
  const open = [
    { id: asInvoiceId("INV-041"), customerId: "CUS-TBK" as CustomerId, remaining: cents(50000), issuedOn: asIsoDate("2026-10-15") },
    { id: asInvoiceId("INV-042"), customerId: "CUS-TBK" as CustomerId, remaining: cents(30000), issuedOn: asIsoDate("2026-10-15") },
  ];
  const hints = regexHints("TAN BK 41/42", new Set(["INV-041", "INV-042"]));
  const result = match({
    credit: { amount: cents(80000), rawRef: "TAN BK 41/42", payerName: "TAN BK CAFE", valueDate: asIsoDate("2026-11-17") },
    openInvoices: open,
    confirmedAliases: [{ alias: "TAN BK", customerId: "CUS-TBK" as CustomerId, customerName: "Tan BK Café" }],
    hints,
  });
  expect(result.kind).toBe("suggested");
  if (result.kind !== "suggested" || result.suggestion.kind !== "split") throw new Error("expected split");
  const total = result.suggestion.parts.reduce((sum, part) => sum + (part.amount as number), 0);
  expect(total).toBe(80000);
  expect(result.suggestion.parts.map((part) => part.invoiceId).sort()).toEqual(["INV-041", "INV-042"]);
});

test("demo credits follow the fixture table and the hero reason", async () => {
  const db = freshDb();
  const imported = await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
  expect(imported.ok).toBe(true);
  if (!imported.ok) return;
  expect(imported.status).toBe("Imported 6 new, 0 already imported, 0 need review");
  const again = await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
  expect(again.ok && again.status).toBe("Imported 0 new, 6 already imported, 0 need review");
  const model = reviewModel(loadSnapshot(db));
  const byLine = Object.fromEntries(model.cards.map((card) => [card.fileLine, card]));
  expect(byLine[17]).toMatchObject({ state: "Suggested", rule: "R3", shortfallLabel: "possible short payment S$38.40", reason: HERO });
  expect(byLine[18]).toMatchObject({ rule: "R2" });
  expect(byLine[19]).toMatchObject({ rule: "R4", kind: "split" });
  expect(byLine[20]).toMatchObject({ rule: "R5", kind: "choose_one", preselected: false });
  expect(byLine[21]).toMatchObject({ rule: "R1", preselected: true });
  expect(byLine[22].reason).toBe("no open invoice for S$75.00 within 60 days");
});

describe("hints", () => {
  test("regex maps bare numbers onto known invoice ids", () => {
    const hints = regexHints("ABC CAT 104", new Set(["INV-104", "INV-041", "INV-042"]));
    expect(hints.invoiceTokens).toEqual(["INV-104"]);
    expect(regexHints("TAN BK 41/42", new Set(["INV-041", "INV-042"])).invoiceTokens).toEqual(["INV-041", "INV-042"]);
  });
});
