import fc from "fast-check";
import { expect, test } from "vitest";
import { cents } from "@/domain/money";
import { violations } from "@/domain/invariants";
import type { ImportBatchId, InvoiceId } from "@/domain/ids";
import { asIsoDate } from "@/domain/ids";
import type { SuggestionId } from "@/domain/ids";
import { loadSnapshot, run } from "@/server/ledger";
import { freshDb, NOW } from "../helpers";

const OWNER = { kind: "human" as const, id: "owner", name: "Kim Hock" };
const runs = Number(process.env.TALLY_PROP_RUNS ?? 200);

type Book = ReturnType<typeof freshDb>;
type Model = { n: number };

class ImportCmd implements fc.Command<Model, Book> {
  constructor(readonly amount: number, readonly token: string, readonly salt: number) {}
  check() { return true; }
  run(_model: Model, db: Book) {
    const result = run(db, {
      kind: "import_batch",
      actor: OWNER,
      batch: {
        bank: "DBS",
        batchId: `m-${this.salt}` as ImportBatchId,
        fileName: "model.csv",
        skippedDebits: 0,
        rows: [{ fileLine: this.salt, valueDate: asIsoDate("2026-11-17"), amount: cents(this.amount), rawRef: this.token, payerName: "OTHR TRF", bankTxnId: `txn-${this.salt}`, reviewFlags: [] }],
      },
    }, NOW);
    expect(result.ok).toBe(true);
  }
  toString() { return `import ${this.amount}`; }
}

class WriteOffCmd implements fc.Command<Model, Book> {
  constructor(readonly invoice: string, readonly amount: number, readonly reason: string, readonly human: boolean) {}
  check() { return true; }
  run(_model: Model, db: Book) {
    const before = JSON.stringify(loadSnapshot(db).invoices.get(this.invoice as InvoiceId));
    const result = run(db, { kind: "write_off", invoiceId: this.invoice as InvoiceId, amount: cents(this.amount), reason: this.reason, by: this.human ? OWNER : { kind: "system" } }, NOW);
    if (!result.ok) expect(JSON.stringify(loadSnapshot(db).invoices.get(this.invoice as InvoiceId))).toBe(before);
  }
  toString() { return `write_off ${this.invoice}`; }
}

class CommitCmd implements fc.Command<Model, Book> {
  check() { return true; }
  run(_model: Model, db: Book) {
    run(db, { kind: "commit_approved", by: OWNER }, NOW);
  }
  toString() { return "commit"; }
}

class ApproveCmd implements fc.Command<Model, Book> {
  constructor(readonly pick: number) {}
  check() { return true; }
  run(_model: Model, db: Book) {
    const snap = loadSnapshot(db);
    const open = [...snap.suggestions.values()].filter((row) => row.status === "open");
    if (open.length === 0) return;
    const suggestion = open[this.pick % open.length]!;
    const before = snap.audit.length;
    const pick = suggestion.body.kind === "choose_one" ? suggestion.body.candidates[0] ?? null : null;
    const result = run(db, { kind: "approve", suggestionId: suggestion.id as SuggestionId, pick, by: OWNER }, NOW);
    if (!result.ok) expect(loadSnapshot(db).audit.length).toBe(before);
  }
  toString() { return "approve"; }
}

test("P-C random command sequences leave I1-I10 and C1-C3 clean", () => {
  fc.assert(fc.property(fc.commands<Model, Book>([
    fc.integer({ min: 30, max: 80000 }).chain((amount) => fc.integer({ min: 1, max: 9000 }).map((salt) => new ImportCmd(amount, salt % 2 === 0 ? "INV-110" : "", salt))),
    fc.constantFrom("INV-104", "INV-105", "INV-110").chain((invoice) => fc.tuple(fc.integer({ min: 1, max: 5000 }), fc.constantFrom("", "short crate", "  "), fc.boolean()).map(([amount, reason, human]) => new WriteOffCmd(invoice, amount, reason, human))),
    fc.constant(new CommitCmd()),
    fc.integer({ min: 0, max: 6 }).map((pick) => new ApproveCmd(pick)),
  ], { size: "small" }), (commands) => {
    let db!: Book;
    fc.modelRun(() => {
      db = freshDb();
      return { model: { n: 0 }, real: db };
    }, commands);
    expect(violations(loadSnapshot(db))).toEqual([]);
  }), { numRuns: runs });
});
