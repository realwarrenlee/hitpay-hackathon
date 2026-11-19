import { expect, test } from "vitest";
import { parseDbs } from "@/server/import/dbs";
import { fixture } from "../helpers";

test("the demo file keeps credits on lines 17 to 22", () => {
  const parsed = parseDbs(fixture("fixtures/dbs/demo.csv"), "demo.csv");
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.rows.map((row) => [row.fileLine, row.amount, row.rawRef])).toEqual([
    [17, 46160, "ABC CAT 104"],
    [18, 50000, "AH SENG"],
    [19, 80000, "TAN BK 41/42"],
    [20, 50000, ""],
    [21, 18000, "INV-110"],
    [22, 7500, "MISC 9931"],
  ]);
  expect(parsed.value.skippedDebits).toBe(0);
});

test("a bad amount is rejected on its file line", () => {
  const parsed = parseDbs(fixture("fixtures/dbs/bad-amount.csv"), "bad.csv");
  expect(parsed.ok).toBe(false);
  if (parsed.ok) return;
  expect(parsed.error.code).toBe("bad_amount");
});

test("debits are counted and credits are kept", () => {
  const parsed = parseDbs(fixture("fixtures/dbs/debits-mixed.csv"), "mixed.csv");
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.skippedDebits).toBe(1);
  expect(parsed.value.rows).toHaveLength(1);
  expect(parsed.value.rows[0]?.amount).toBe(18000);
});
