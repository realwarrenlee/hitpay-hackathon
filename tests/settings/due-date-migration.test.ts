import { mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openDatabase } from "@/server/db";
import { bootstrap, loadSnapshot, run } from "@/server/ledger";
import { violations } from "@/domain/invariants";
import { overdueBalance } from "@/domain/balances";
import { NOW } from "../helpers";

test("additive due-date migration preserves legacy money, policy, approved holds and audit across reopen", () => {
  const file = join(mkdtempSync(join(tmpdir(), "tally-due-migration-")), "ledger.db");
  let db = openDatabase(file);
  bootstrap(db, undefined, NOW);
  expect(run(db, { kind: "check_cutoff", customerId: "CUS-ABC" as never, by: { kind: "system" } }, NOW).ok).toBe(true);
  expect(run(db, { kind: "approve_hold", customerId: "CUS-ABC" as never, by: { kind: "human", name: "Test owner" } }, NOW).ok).toBe(true);
  const before = loadSnapshot(db);
  db.exec("ALTER TABLE invoice DROP COLUMN due_on");
  db.close();
  db = openDatabase(file);
  const after = loadSnapshot(db);
  expect(after.invoices).toEqual(new Map([...before.invoices].map(([id, invoice]) => [id, { ...invoice, dueOn: null }])));
  expect(after.audit).toEqual(before.audit);
  expect(after.customers).toEqual(before.customers);
  expect(after.deliveries).toEqual(before.deliveries);
  expect(after.settings).toEqual(before.settings);
  expect(overdueBalance([...after.invoices.values()].map((invoice) => ({ invoice, balance: invoice })), after.settings, after.today)).toBe(0);
  expect(violations(after)).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  db.close();
  db = openDatabase(file);
  expect(loadSnapshot(db)).toEqual(after);
  db.close();
});

test("explicit fixture due dates survive ledger transactions and connection restart", () => {
  const file = join(mkdtempSync(join(tmpdir(), "tally-due-persist-")), "ledger.db");
  let db = openDatabase(file);
  bootstrap(db, undefined, NOW);
  const before = loadSnapshot(db);
  run(db, { kind: "check_cutoff", customerId: "all", by: { kind: "system" } }, NOW);
  db.close();
  db = openDatabase(file);
  expect(loadSnapshot(db).invoices).toEqual(before.invoices);
  expect([...loadSnapshot(db).invoices.values()].every((invoice) => invoice.dueOn != null)).toBe(true);
  db.close();
  const code = "const {getDb,loadSnapshot}=require('./src/server/ledger.ts');const db=getDb();process.stdout.write(JSON.stringify([...loadSnapshot(db).invoices.values()]));db.close();";
  const restarted = JSON.parse(execFileSync(process.execPath, ["--require", "tsx/cjs", "-e", code], {
    encoding: "utf8", env: { ...process.env, TALLY_DB_URL: file, TALLY_GATEWAY: "fake", HINTS_API_KEY: "" },
  }));
  expect(restarted).toEqual([...before.invoices.values()]);
});
