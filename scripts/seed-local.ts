import { readEnv } from "../src/server/env";
import { openDatabase } from "../src/server/db";
import { bootstrap } from "../src/server/ledger";

const env = readEnv();
const snap = bootstrap(openDatabase(env.dbPath));
console.log(`seeded ${snap.invoices.size} invoices into ${env.dbPath}`);
