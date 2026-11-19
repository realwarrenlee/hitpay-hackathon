import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

function slash(path: string): string {
  return path.split("\\").join("/");
}

test("process.env and SQL writes stay in their modules", () => {
  const sources = files("src").map(slash);
  const envHits = sources.filter((path) => path !== "src/server/env.ts" && readFileSync(path, "utf8").includes("process.env"));
  expect(envHits).toEqual([]);
  const sqlHits = sources.filter((path) => {
    if (path === "src/server/ledger.ts" || path === "src/server/db.ts") return false;
    return /\b(INSERT|UPDATE|DELETE)\b/.test(readFileSync(path, "utf8"));
  });
  expect(sqlHits).toEqual([]);
});

test("the domain stays free of clocks and randomness", () => {
  const hits = files("src/domain").filter((path) => /Date\.now|new Date|Math\.random|process\.env/.test(readFileSync(path, "utf8")));
  expect(hits).toEqual([]);
});
