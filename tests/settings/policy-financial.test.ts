import { describe, expect, test, afterEach, vi } from "vitest";
import fc from "fast-check";
import { cents } from "@/domain/money";
import { asIsoDate } from "@/domain/ids";
import { addDays } from "@/domain/dates";
import { overdueBalance } from "@/domain/balances";
import { decide } from "@/domain/decide";
import { violations } from "@/domain/invariants";
import { loadSnapshot, run } from "@/server/ledger";
import {
  importBytes,
  approveSuggestion,
  approveCustomerHold,
  requestRemainder,
} from "@/server/flow";
import { FakeGateway } from "@/server/hitpay/fake";
import { reconcilePayment } from "@/server/hitpay/webhook";
import { reviewModel } from "@/server/views";
import { freshDb, fixture, NOW } from "../helpers";
const actor = {
  kind: "human" as const,
  name: "Local development operator",
  access: "loopback_development" as const,
};
function world(
  age: number,
  days: number | null,
  amount = 5000,
  threshold = 3000,
) {
  const db = freshDb();
  const s = loadSnapshot(db);
  db.close();
  const invoice = s.invoices.get("INV-104" as never)!;
  invoice.dueOn = addDays(s.today, -age);
  invoice.total = cents(amount);
  invoice.remaining = cents(amount);
  invoice.followUpOn = asIsoDate("2099-01-01");
  s.invoices = new Map([[invoice.id, invoice]]);
  s.settings = {
    overdueBalanceThreshold: cents(threshold),
    overdueDaysThreshold: days,
  };
  const rows = [
    {
      invoice,
      balance: {
        allocated: invoice.allocated,
        writtenOff: invoice.writtenOff,
        remaining: invoice.remaining,
        status: invoice.status,
      },
    },
  ];
  const overdue = overdueBalance(rows, s.settings, s.today);
  const result = decide(
    s,
    {
      kind: "check_cutoff",
      customerId: invoice.customerId,
      by: { kind: "human", name: "Operator" },
    },
    NOW,
  );
  expect(result.ok).toBe(true);
  return { s, overdue, after: result.ok ? result.value.snapshot : s };
}
afterEach(() => vi.unstubAllEnvs());
describe("approved overdue hold policy", () => {
  test("strict threshold boundary property", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), (amount) => {
        expect(
          world(90, null, amount, amount).after.customers.get(
            "CUS-ABC" as never,
          )?.hold.status,
        ).toBe("normal");
      }),
      { numRuns: 100 },
    );
  });
  test("policy updates never queue evaluation or alter historic records property", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100000 }),
        fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
        (amount, days) => {
          const { s } = world(5, null);
          const before = structuredClone(s);
          const result = decide(
            s,
            {
              kind: "update_policy",
              values: {
                overdueBalanceThreshold: cents(amount),
                overdueDaysThreshold: days,
              },
              expectedVersion: s.policyVersion,
              by: actor,
            },
            NOW,
          );
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.followUps).toEqual([]);
          expect(result.value.snapshot.customers).toEqual(before.customers);
          expect(result.value.snapshot.allocations).toEqual(before.allocations);
          expect(result.value.snapshot.paymentRequests).toEqual(
            before.paymentRequests,
          );
          expect(result.value.snapshot.deliveries).toEqual(before.deliveries);
          expect(
            result.value.snapshot.audit.slice(0, before.audit.length),
          ).toEqual(before.audit);
        },
      ),
      { numRuns: 80 },
    );
  });

  test.each([
    [0, null, 0, "normal"],
    [-1, null, 0, "normal"],
    [1, 1, 0, "normal"],
    [2, 1, 5000, "proposed"],
    [0, 1, 0, "normal"],
    [10, 30, 0, "normal"],
  ] as const)(
    "days past due %s and grace %s agree in display and hold",
    (age, days, expected, status) => {
      const result = world(age, days);
      expect(result.overdue).toBe(expected);
      expect(result.after.customers.get("CUS-ABC" as never)?.hold.status).toBe(
        status,
      );
    },
  );
  test("equality at the monetary threshold does not propose a hold", () =>
    expect(
      world(100, 1, 3000, 3000).after.customers.get("CUS-ABC" as never)?.hold
        .status,
    ).toBe("normal"));
  test("old invoice below threshold has no independent age-only trigger", () =>
    expect(
      world(100, 1, 1000, 3000).after.customers.get("CUS-ABC" as never)?.hold
        .status,
    ).toBe("normal"));
  test("SGT policy calendar handles leap-day and year boundaries using due dates", () => {
    const x = world(2, 1);
    expect(x.overdue).toBe(5000);
    const invoice = [...x.s.invoices.values()][0];
    x.s.today = asIsoDate("2024-03-01");
    invoice.dueOn = asIsoDate("2024-02-29");
    expect(
      overdueBalance(
        [
          {
            invoice,
            balance: {
              allocated: invoice.allocated,
              writtenOff: invoice.writtenOff,
              remaining: invoice.remaining,
              status: invoice.status,
            },
          },
        ],
        x.s.settings,
        x.s.today,
      ),
    ).toBe(0);
    x.s.today = asIsoDate("2025-01-01");
    invoice.dueOn = asIsoDate("2024-12-30");
    expect(
      overdueBalance(
        [
          {
            invoice,
            balance: {
              allocated: invoice.allocated,
              writtenOff: invoice.writtenOff,
              remaining: invoice.remaining,
              status: invoice.status,
            },
          },
        ],
        x.s.settings,
        x.s.today,
      ),
    ).toBe(5000);
  });
  test("display and hold eligibility share one calculation across ages, thresholds and amounts", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5, max: 90 }),
        fc.option(fc.integer({ min: 1, max: 40 }), { nil: null }),
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 0, max: 100000 }),
        (age, days, amount, threshold) => {
          const result = world(age, days, amount, threshold);
          const eligible = age > (days ?? 0);
          expect(result.overdue).toBe(eligible ? amount : 0);
          expect(
            result.after.customers.get("CUS-ABC" as never)?.hold.status,
          ).toBe(eligible && amount > threshold ? "proposed" : "normal");
          expect(
            [...result.after.customers.values()].some(
              (c) => c.hold.status === "pay_first",
            ),
          ).toBe(false);
        },
      ),
      { numRuns: 150 },
    );
  });
  test("saving changes only future evaluations, preserving approved holds, allocations and history", async () => {
    const db = freshDb();
    await importBytes(
      db,
      fixture("fixtures/dbs/demo.csv"),
      "demo.csv",
      undefined,
      NOW,
    );
    const line = reviewModel(loadSnapshot(db)).cards.find(
      (row) => row.fileLine === 17,
    )!;
    approveSuggestion(db, line.suggestionId!, null, undefined, NOW);
    await approveCustomerHold(
      db,
      new FakeGateway(),
      "CUS-ABC" as never,
      undefined,
      NOW,
    );
    const before = loadSnapshot(db);
    expect(
      run(
        db,
        {
          kind: "update_policy",
          values: {
            overdueBalanceThreshold: cents(100000),
            overdueDaysThreshold: 30,
          },
          expectedVersion: 0,
          by: actor,
        },
        NOW,
      ).ok,
    ).toBe(true);
    const after = loadSnapshot(db);
    expect(after.customers).toEqual(before.customers);
    expect(after.deliveries).toEqual(before.deliveries);
    expect(after.allocations).toEqual(before.allocations);
    expect(after.invoices).toEqual(before.invoices);
    expect(after.paymentRequests).toEqual(before.paymentRequests);
    expect(after.audit.slice(0, -1)).toEqual(before.audit);
    expect(violations(after)).toEqual([]);
    db.close();
  });
  test("policy saves neither replay payments nor change environment-controlled auto-approval", async () => {
    vi.stubEnv("TALLY_AUTO_APPROVE_REMAINDER", "off");
    const db = freshDb();
    const gateway = new FakeGateway();
    await importBytes(
      db,
      fixture("fixtures/dbs/demo.csv"),
      "demo.csv",
      undefined,
      NOW,
    );
    const line = reviewModel(loadSnapshot(db)).cards.find(
      (row) => row.fileLine === 17,
    )!;
    approveSuggestion(db, line.suggestionId!, null, undefined, NOW);
    await requestRemainder(db, gateway, "INV-104" as never, undefined, NOW);
    const request = [...loadSnapshot(db).paymentRequests.values()][0];
    gateway.markStatus(request.hitpayRequestId!, "completed");
    const before = loadSnapshot(db);
    expect(
      run(
        db,
        {
          kind: "update_policy",
          values: {
            overdueBalanceThreshold: cents(5000),
            overdueDaysThreshold: null,
          },
          expectedVersion: 0,
          by: actor,
        },
        NOW,
      ).ok,
    ).toBe(true);
    const after = loadSnapshot(db);
    expect(after.autoApproveRemainder).toBe(false);
    expect(after.receipts).toEqual(before.receipts);
    expect(after.allocations).toEqual(before.allocations);
    expect(after.paymentRequests).toEqual(before.paymentRequests);
    await reconcilePayment(db, gateway, request.id, NOW);
    expect(loadSnapshot(db).invoices.get("INV-104" as never)?.status).toBe(
      "partially_paid",
    );
    db.close();
  });
});
