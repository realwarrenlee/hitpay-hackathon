import { describe, expect, test } from "vitest";
import { customerBalances } from "@/server/dashboard";
import { loadSnapshot } from "@/server/ledger";
import { approveSuggestion, importBytes } from "@/server/flow";
import { reviewModel } from "@/server/views";
import { freshDb, fixture, NOW } from "../helpers";

describe("dashboard balances", () => {
  test("overdue balances do not imply an approved delivery hold or mutate the ledger", () => {
    const db = freshDb();
    const snapshot = loadSnapshot(db);
    const before = JSON.stringify([...snapshot.customers.values()]);
    const rows = customerBalances(snapshot);
    expect(rows.find((row) => row.id === "CUS-ABC")).toMatchObject({
      outstanding: 50000,
      overdue: 50000,
      hold: "normal",
      invoices: 1,
    });
    expect(rows.filter((row) => row.hold === "pay_first")).toHaveLength(0);
    expect(JSON.stringify([...snapshot.customers.values()])).toBe(before);
    db.close();
  });
  test("approved credits update displayed balances while proposed holds remain separate", async () => {
    const db = freshDb();
    await importBytes(
      db,
      fixture("fixtures/dbs/demo.csv"),
      "demo.csv",
      undefined,
      NOW,
    );
    const suggestion = reviewModel(loadSnapshot(db)).cards.find(
      (row) => row.fileLine === 17,
    )!;
    expect(
      approveSuggestion(db, suggestion.suggestionId!, null, undefined, NOW).ok,
    ).toBe(true);
    expect(
      customerBalances(loadSnapshot(db)).find((row) => row.id === "CUS-ABC"),
    ).toMatchObject({ outstanding: 3840, overdue: 3840, hold: "proposed" });
    db.close();
  });
});
