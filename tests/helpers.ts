import { readFileSync } from "node:fs";
import type { Instant } from "@/domain/ids";
import { openDatabase } from "@/server/db";
import { bootstrap } from "@/server/ledger";

export const NOW = "2026-11-17T10:00:00+08:00" as Instant;

export function freshDb() {
  const db = openDatabase(":memory:");
  bootstrap(db, undefined, NOW);
  return db;
}

export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(name));
}
