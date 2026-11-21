import { afterEach, expect, test } from "vitest";
import { freshDb, fixture, NOW } from "../helpers";
import { importBytes } from "@/server/flow";
import { loadSnapshot, run } from "@/server/ledger";
import { reviewModel } from "@/server/views";
import { violations } from "@/domain/invariants";
import { operator as by } from "./helpers";
const databases: ReturnType<typeof freshDb>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function setup() {
  const db = freshDb();
  databases.push(db);
  await importBytes(
    db,
    fixture("fixtures/dbs/demo.csv"),
    "demo.csv",
    undefined,
    NOW,
  );
  await importBytes(
    db,
    new TextEncoder().encode(
      "Transaction Date,a,b,c,d,e,f,Debit,Credit,Payer\n17 Nov 2026,,,INV-104,,,,,500.00,ABC CAT\n17 Nov 2026,,,INV-105,,,,,500.00,AH SENG\n",
    ),
    "exact.csv",
    undefined,
    NOW,
  );
  const cards = reviewModel(loadSnapshot(db)).cards;
  return {
    db,
    exact: cards.filter((c) => c.preselected),
    partial: cards.find((c) => c.rule === "R3")!,
  };
}
test("batch approval applies only explicitly selected exact matches; reconciliation locks only selected approvals without taking money twice", async () => {
  const { db, exact } = await setup();
  expect(exact).toHaveLength(3);
  const target = exact.find((c) => c.matchSummary === "INV-110")!;
  const before = loadSnapshot(db);
  expect(
    run(
      db,
      {
        kind: "approve_preselected",
        suggestionIds: [target.suggestionId!],
        by,
      },
      NOW,
    ).ok,
  ).toBe(true);
  const approved = loadSnapshot(db);
  expect(approved.invoices.get("INV-110" as never)!.remaining).toBe(0);
  for (const other of exact.filter((c) => c !== target)) {
    expect(approved.suggestions.get(other.suggestionId!)!.status).toBe("open");
    expect(approved.credits.get(other.creditId)).toEqual(
      before.credits.get(other.creditId),
    );
  }
  const second = exact.find((c) => c.matchSummary === "INV-105")!;
  expect(
    run(
      db,
      {
        kind: "approve_preselected",
        suggestionIds: [second.suggestionId!],
        by,
      },
      NOW,
    ).ok,
  ).toBe(true);
  const preCommit = loadSnapshot(db);
  const allocation = [...preCommit.allocations.values()].find(
    (a) => a.creditId === target.creditId,
  )!;
  expect(
    run(
      db,
      { kind: "commit_approved", allocationIds: [allocation.id], by },
      NOW,
    ).ok,
  ).toBe(true);
  const committed = loadSnapshot(db);
  expect(committed.allocations.get(allocation.id)!.state).toBe("reconciled");
  expect(
    [...committed.allocations.values()].find(
      (a) => a.creditId === second.creditId,
    )!.state,
  ).toBe("approved");
  expect(committed.invoices).toEqual(preCommit.invoices);
  expect(committed.credits).toEqual(preCommit.credits);
  expect(
    committed.audit.slice(preCommit.audit.length).map((a) => a.entityId),
  ).toEqual([allocation.id]);
  expect(violations(committed)).toEqual([]);
});
test("empty, duplicate, unknown and non-exact approval targets fail atomically", async () => {
  const { db, exact, partial } = await setup();
  const valid = exact[0].suggestionId!;
  for (const suggestionIds of [
    [],
    [valid, valid],
    [valid, "SUG-missing" as never],
    [valid, partial.suggestionId!],
  ]) {
    const before = loadSnapshot(db);
    expect(
      run(db, { kind: "approve_preselected", suggestionIds, by }, NOW).ok,
    ).toBe(false);
    expect(loadSnapshot(db)).toEqual(before);
  }
});
test("stale or overlapping approval selections roll back all balance, state and audit changes", async () => {
  const { db, exact, partial } = await setup();
  expect(
    run(
      db,
      { kind: "approve", suggestionId: partial.suggestionId!, pick: null, by },
      NOW,
    ).ok,
  ).toBe(true);
  const before = loadSnapshot(db);
  const overlapping = exact.find((c) => c.matchSummary === "INV-104")!;
  const other = exact.find((c) => c.matchSummary === "INV-110")!;
  expect(
    run(
      db,
      {
        kind: "approve_preselected",
        suggestionIds: [other.suggestionId!, overlapping.suggestionId!],
        by,
      },
      NOW,
    ).ok,
  ).toBe(false);
  expect(loadSnapshot(db)).toEqual(before);
  expect(
    run(
      db,
      {
        kind: "approve_preselected",
        suggestionIds: [partial.suggestionId!],
        by,
      },
      NOW,
    ).ok,
  ).toBe(false);
  expect(loadSnapshot(db)).toEqual(before);
});
test("empty, duplicate, unapproved and stale reconciliation targets cannot commit other allocations", async () => {
  const { db, exact } = await setup();
  expect(
    run(
      db,
      {
        kind: "approve_preselected",
        suggestionIds: [exact[0].suggestionId!],
        by,
      },
      NOW,
    ).ok,
  ).toBe(true);
  const s = loadSnapshot(db);
  const approved = [...s.allocations.values()].find(
    (a) => a.state === "approved",
  )!;
  const suggested = [...s.allocations.values()].find(
    (a) => a.state === "suggested",
  )!;
  for (const allocationIds of [
    [],
    [approved.id, approved.id],
    [approved.id, suggested.id],
    [approved.id, "ALC-missing" as never],
  ]) {
    const before = loadSnapshot(db);
    expect(
      run(db, { kind: "commit_approved", allocationIds, by }, NOW).ok,
    ).toBe(false);
    expect(loadSnapshot(db)).toEqual(before);
  }
  expect(
    run(db, { kind: "commit_approved", allocationIds: [approved.id], by }, NOW)
      .ok,
  ).toBe(true);
  const before = loadSnapshot(db);
  expect(
    run(db, { kind: "commit_approved", allocationIds: [approved.id], by }, NOW)
      .ok,
  ).toBe(false);
  expect(loadSnapshot(db)).toEqual(before);
});

test("accepted ambiguous suggestions display only the chosen invoice, never the rejected alternatives", async () => {
  const { db } = await setup();
  const card = reviewModel(loadSnapshot(db)).cards.find(
    (c) => c.kind === "choose_one",
  )!;
  expect(card.options.map((option) => option.invoiceId).sort()).toEqual([
    "INV-041",
    "INV-104",
    "INV-105",
  ]);
  const choice = card.options[0].invoiceId;
  expect(
    run(
      db,
      { kind: "approve", suggestionId: card.suggestionId!, pick: choice, by },
      NOW,
    ).ok,
  ).toBe(true);
  const accepted = reviewModel(loadSnapshot(db)).cards.find(
    (c) => c.creditId === card.creditId,
  )!;
  expect(accepted.options.map((option) => option.invoiceId)).toEqual([choice]);
  expect(accepted.matchSummary).toBe(choice);
});
