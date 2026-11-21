import { expect, test } from "vitest";
import { addDays } from "@/domain/dates";
import { asIsoDate } from "@/domain/ids";
import { violations } from "@/domain/invariants";
import { importBytes, approveSuggestion } from "@/server/flow";
import { loadSnapshot } from "@/server/ledger";
import { freshDb, NOW } from "../helpers";

test("a 120-day reference survives import candidate selection, deduplicates and requires human approval", async () => {
  const db = freshDb();
  const issue = asIsoDate("2026-10-28");
  const date = addDays(issue, 120);
  const [year, month, day] = date.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const csv = new TextEncoder().encode(`Transaction Date,a,b,c,d,e,f,Debit,Credit,Payer\n${day} ${months[Number(month) - 1]} ${year},,,INV-104,,,,,500.00,ABC CAT\n`);
  expect((await importBytes(db, csv, "late-fictional.csv", undefined, NOW)).ok).toBe(true);
  const before = loadSnapshot(db);
  const suggestion = [...before.suggestions.values()][0];
  expect(suggestion.body).toMatchObject({ rule: "R1", invoiceId: "INV-104", amount: 50000 });
  expect(before.invoices.get("INV-104" as never)!.remaining).toBe(50000);
  expect([...before.allocations.values()].every((row) => row.state === "suggested")).toBe(true);
  expect((await importBytes(db, csv, "late-fictional.csv", undefined, NOW)).ok).toBe(true);
  expect(loadSnapshot(db).credits.size).toBe(1);
  expect(loadSnapshot(db).suggestions.size).toBe(1);
  expect(approveSuggestion(db, suggestion.id, null, { kind: "human", name: "Test owner" }, NOW).ok).toBe(true);
  expect(loadSnapshot(db).invoices.get("INV-104" as never)!.remaining).toBe(0);
  expect(violations(loadSnapshot(db))).toEqual([]);
  db.close();
});
