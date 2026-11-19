import { spawnSync } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";

const mode = process.argv[2];
if (mode !== "record" && mode !== "long") throw new Error("Expected record or long");
let output;
if (mode === "record") {
  mkdirSync("artifacts/check", { recursive: true });
  const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  const id = git.status === 0 ? git.stdout.trim() : new Date().toISOString().replace(/[:.]/g, "-");
  const path = `artifacts/check/${id}.txt`;
  console.log(`Saving check output to ${path}`);
  output = openSync(path, "w");
}
const commands = mode === "long"
  ? [["node_modules/vitest/vitest.mjs", "run", "tests/model/ledger.model.test.ts", "--testTimeout=120000"]]
  : [["node_modules/typescript/bin/tsc", "--noEmit"], ["node_modules/eslint/bin/eslint.js", "."], ["node_modules/vitest/vitest.mjs", "run"]];
let status = 0;
try {
  for (const args of commands) {
    const result = spawnSync(process.execPath, args, {
      env: mode === "long" ? { ...process.env, TALLY_PROP_RUNS: "5000" } : process.env,
      stdio: output === undefined ? "inherit" : ["ignore", output, output],
    });
    status = result.status ?? 1;
    if (status !== 0) break;
  }
} finally {
  if (output !== undefined) closeSync(output);
}
process.exitCode = status;
