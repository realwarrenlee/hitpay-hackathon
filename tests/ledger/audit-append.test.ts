import { expect, test } from "vitest";
import { freshDb } from "../helpers";

test("audit rows cannot be updated or deleted", () => {
  const db = freshDb();
  expect(() => db.exec("UPDATE audit_event SET action = 'edited'")).toThrow(/append-only/);
  expect(() => db.exec("DELETE FROM audit_event")).toThrow(/append-only/);
});
