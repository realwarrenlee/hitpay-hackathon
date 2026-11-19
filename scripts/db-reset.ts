import { rmSync } from "node:fs";
import { readEnv } from "../src/server/env";
import { openDatabase } from "../src/server/db";
import { bootstrap } from "../src/server/ledger";

const env = readEnv();
if (env.dbPath !== ":memory:") rmSync(env.dbPath, { force: true });
bootstrap(openDatabase(env.dbPath));
console.log(`reset ${env.dbPath}`);
