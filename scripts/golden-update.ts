import { readFileSync, writeFileSync } from "node:fs";
import { parseDbs } from "../src/server/import/dbs";

const bytes = new Uint8Array(readFileSync("fixtures/dbs/demo.csv"));
const parsed = parseDbs(bytes, "demo.csv");
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}
writeFileSync("tests/import/dbs.golden.json", `${JSON.stringify(parsed.value, null, 2)}\n`);
console.log("wrote tests/import/dbs.golden.json");
