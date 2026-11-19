import { afterEach, describe, expect, test, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { cents } from "@/domain/money";
import { openDatabase } from "@/server/db";
import * as ledger from "@/server/ledger";
import { savePolicy } from "@/server/policy";
import {
  installLocalPolicyContext,
  type LocalPolicyRequest,
} from "@/server/local-request-context";
import { freshDb, NOW } from "../helpers";
const actor = {
  kind: "human" as const,
  name: "Local development operator",
  access: "loopback_development" as const,
};
const values = (amount = 5000, days: number | null = 7) => ({
  overdueBalanceThreshold: cents(amount),
  overdueDaysThreshold: days,
});
const payload = {
  threshold: "50.01",
  minimumDays: "7",
  ageMode: "custom",
  expectedVersion: 0,
};
const request: LocalPolicyRequest = {
  localAddress: "127.0.0.1",
  remoteAddress: "127.0.0.1",
  host: "127.0.0.1:43123",
  origin: "http://127.0.0.1:43123",
  method: "POST",
  port: 43123,
};
const opened: DatabaseSync[] = [];
const dirs: string[] = [];
function fresh() {
  const db = freshDb();
  opened.push(db);
  return db;
}
function allowed<T>(fn: () => T) {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("TALLY_LOCAL_POLICY_EDITS", "on");
  return installLocalPolicyContext().run(request, fn);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const db of opened.splice(0)) {
    try {
      db.close();
    } catch {}
  }
  for (const dir of dirs.splice(0)) {
    expect(dirname(resolve(dir))).toBe(resolve(tmpdir()));
    rmSync(dir, { recursive: true, force: true });
  }
});
describe("policy ledger and service", () => {
  test("atomically persists exact values, version and explicit local actor audit", () => {
    const db = fresh();
    vi.spyOn(ledger, "getDb").mockReturnValue(db);
    const before = ledger.loadSnapshot(db);
    expect(allowed(() => savePolicy(payload))).toMatchObject({
      ok: true,
      policy: { threshold: "50.01", minimumDays: 7, version: 1 },
    });
    const after = ledger.loadSnapshot(db);
    expect(after.audit.slice(0, -1)).toEqual(before.audit);
    expect(after.audit.at(-1)).toMatchObject({
      action: "policy_updated",
      actor,
      entity: "settings",
      before: { ...before.settings, version: 0 },
      after: {
        overdueBalanceThreshold: 5001,
        overdueDaysThreshold: 7,
        version: 1,
      },
    });
    expect(after.audit.at(-1)?.at).toBeTruthy();
  });
  test("two clients at one version cannot silently overwrite each other", () => {
    const db = fresh();
    expect(
      ledger.run(
        db,
        {
          kind: "update_policy",
          values: values(),
          expectedVersion: 0,
          by: actor,
        },
        NOW,
      ).ok,
    ).toBe(true);
    const audits = ledger.loadSnapshot(db).audit.length;
    expect(
      ledger.run(
        db,
        {
          kind: "update_policy",
          values: values(10000, 14),
          expectedVersion: 0,
          by: actor,
        },
        NOW,
      ),
    ).toMatchObject({ ok: false, error: { code: "policy_conflict" } });
    expect(ledger.loadSnapshot(db)).toMatchObject({
      settings: values(),
      policyVersion: 1,
    });
    expect(ledger.loadSnapshot(db).audit).toHaveLength(audits);
  });
  test("no-op saves create no fake change or version increment", () => {
    const db = fresh();
    const s = ledger.loadSnapshot(db);
    expect(
      ledger.run(
        db,
        {
          kind: "update_policy",
          values: s.settings,
          expectedVersion: 0,
          by: actor,
        },
        NOW,
      ).ok,
    ).toBe(true);
    expect(ledger.loadSnapshot(db).audit).toEqual(s.audit);
    expect(ledger.loadSnapshot(db).policyVersion).toBe(0);
  });
  test("denies untrusted writes before loading the database", () => {
    const get = vi.spyOn(ledger, "getDb");
    expect(savePolicy(payload)).toMatchObject({
      ok: false,
      code: "access_denied",
    });
    expect(get).not.toHaveBeenCalled();
  });
  test("invalid payload and forged auto-approval/actor fields cannot mutate", () => {
    const db = fresh();
    vi.spyOn(ledger, "getDb").mockReturnValue(db);
    const before = ledger.loadSnapshot(db);
    for (const input of [
      { ...payload, threshold: "NaN" },
      { ...payload, minimumDays: "0" },
      { ...payload, autoApproveRemainder: false },
      { ...payload, by: actor },
    ])
      expect(allowed(() => savePolicy(input)).ok).toBe(false);
    expect(ledger.loadSnapshot(db)).toEqual(before);
  });
  test("failure writing audit rolls back values and records no success", () => {
    const db = fresh();
    vi.spyOn(ledger, "getDb").mockReturnValue(db);
    const before = ledger.loadSnapshot(db);
    db.exec(
      "CREATE TRIGGER reject_policy_audit BEFORE INSERT ON audit_event WHEN NEW.action = 'policy_updated' BEGIN SELECT RAISE(ABORT,'test storage failure'); END",
    );
    expect(allowed(() => savePolicy(payload))).toMatchObject({
      ok: false,
      code: "save_failed",
    });
    expect(ledger.loadSnapshot(db)).toEqual(before);
  });
  test.each([null, 7])(
    "age %s and monetary values survive connection reopen and a fresh backend process",
    (days) => {
      const dir = mkdtempSync(join(tmpdir(), "tally-policy-"));
      dirs.push(dir);
      const path = join(dir, "ledger.db");
      let db = openDatabase(path);
      ledger.bootstrap(db, undefined, NOW);
      expect(
        ledger.run(
          db,
          {
            kind: "update_policy",
            values: values(5001, days),
            expectedVersion: 0,
            by: actor,
          },
          NOW,
        ).ok,
      ).toBe(true);
      db.close();
      db = openDatabase(path);
      expect(ledger.loadSnapshot(db)).toMatchObject({
        settings: values(5001, days),
        policyVersion: 1,
      });
      db.close();
      const code =
        "const {openDatabase}=require('./src/server/db.ts');const {loadSnapshot}=require('./src/server/ledger.ts');const db=openDatabase(process.argv[1]);const s=loadSnapshot(db);process.stdout.write(JSON.stringify({settings:s.settings,version:s.policyVersion}));db.close();";
      const result = JSON.parse(
        execFileSync(
          process.execPath,
          ["--require", "tsx/cjs", "-e", code, path],
          { encoding: "utf8" },
        ),
      );
      expect(result).toEqual({ settings: values(5001, days), version: 1 });
    },
  );
  test("version migration preserves legacy NULL, ledger data and immutable history", () => {
    const dir = mkdtempSync(join(tmpdir(), "tally-policy-"));
    dirs.push(dir);
    const path = join(dir, "legacy.db");
    let db = openDatabase(path);
    ledger.bootstrap(db, undefined, NOW);
    const before = ledger.loadSnapshot(db);
    db.exec("ALTER TABLE settings DROP COLUMN policy_version");
    db.close();
    db = openDatabase(path);
    const after = ledger.loadSnapshot(db);
    expect(after.settings).toEqual(before.settings);
    expect(after.settings.overdueDaysThreshold).toBeNull();
    expect(after.invoices).toEqual(before.invoices);
    expect(after.audit).toEqual(before.audit);
    expect(after.policyVersion).toBe(0);
    expect(() =>
      db.prepare("UPDATE audit_event SET action='changed'").run(),
    ).toThrow("append-only");
    db.close();
  });
});
