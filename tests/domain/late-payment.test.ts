import { expect, test } from "vitest";
import { addDays, inCandidateWindow } from "@/domain/dates";
import { match, type MatchInput } from "@/domain/match";
import { asInvoiceId, asIsoDate, type CustomerId } from "@/domain/ids";
import { cents } from "@/domain/money";

function input(age: number, rawRef = "INV-901"): MatchInput {
  const valueDate = asIsoDate("2026-11-17");
  return {
    credit: { amount: cents(5000), rawRef, payerName: "", valueDate },
    openInvoices: [{ id: asInvoiceId("INV-901"), customerId: "CUS-ABC" as CustomerId, remaining: cents(5000), issuedOn: addDays(valueDate, -age) }],
    confirmedAliases: [{ alias: "OTHER SHOP", customerId: "CUS-OTHER" as CustomerId, customerName: "Other Shop" }],
    hints: { alias: null, invoiceTokens: ["INV-901"] },
  };
}

test.each([[-1, false], [0, true], [60, true], [61, false], [120, false]])("fallback window at age %s remains %s", (age, expected) => {
  const x = input(age, "unknown");
  x.hints.invoiceTokens = [];
  expect(inCandidateWindow(x.openInvoices[0].issuedOn, x.credit.valueDate)).toBe(expected);
  expect(match(x).kind).toBe(expected ? "suggested" : "unmatched");
});

test("a literal 120-day invoice reference gets a human-approved R1 suggestion", () => {
  const result = match(input(120));
  expect(result).toMatchObject({ kind: "suggested", suggestion: { rule: "R1", invoiceId: "INV-901", preselected: true } });
});

test("model-only tokens and partial invoice references cannot extend the window", () => {
  expect(match(input(120, "unknown")).kind).toBe("unmatched");
  expect(match(input(120, "INV-901999")).kind).toBe("unmatched");
});

test("conflicting customer identity, multiple references, future and paid invoices remain unmatched", () => {
  expect(match(input(120, "OTHER SHOP INV-901")).kind).toBe("unmatched");
  const ambiguous = input(120, "INV-901 INV-902");
  ambiguous.openInvoices = [...ambiguous.openInvoices, { ...ambiguous.openInvoices[0], id: asInvoiceId("INV-902") }];
  ambiguous.hints.invoiceTokens.push("INV-902");
  expect(match(ambiguous).kind).toBe("unmatched");
  expect(match(input(-1)).kind).toBe("unmatched");
  const paid = input(120);
  paid.openInvoices = [{ ...paid.openInvoices[0], remaining: cents(0) }, { ...paid.openInvoices[0], id: asInvoiceId("INV-903"), issuedOn: paid.credit.valueDate }];
  expect(match(paid).kind).toBe("unmatched");
});
