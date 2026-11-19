import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseDbs } from "@/server/import/dbs";
import { fixture } from "../helpers";

test("demo.csv matches the generated golden batch", () => {
  const parsed = parseDbs(fixture("fixtures/dbs/demo.csv"), "demo.csv");
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const golden = JSON.parse(readFileSync("tests/import/dbs.golden.json", "utf8"));
  expect(JSON.parse(JSON.stringify(parsed.value))).toEqual(golden);
});
