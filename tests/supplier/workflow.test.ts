import { afterEach, expect, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { cents, formatAmount, parseSgd, type Cents } from "@/domain/money";
import type { PaymentRequest } from "@/domain/types";
import { violations } from "@/domain/invariants";
import { FakeGateway } from "@/server/hitpay/fake";
import { McpGateway } from "@/server/hitpay/mcp";
import { readEnv } from "@/server/env";
import { savePolicy } from "@/server/policy";
import * as ledger from "@/server/ledger";
import {
  importBytes,
  approveSuggestion,
  requestRemainder,
} from "@/server/flow";
import { deliveryDetail } from "@/server/deliveries";
import { localLedgerAccess } from "@/server/local-ledger-access";
import {
  installLocalPolicyContext,
  type LocalPolicyRequest,
} from "@/server/local-request-context";
import { saveEntry } from "@/server/entries";
import { NOW } from "../helpers";
import { supplierDb, invoiceInput, deliveryInput, operator } from "./helpers";

const control = vi.hoisted(() => ({ gateway: null as unknown }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Error(url);
  },
}));
vi.mock("@/server/hitpay/current", () => ({
  currentGateway: () => control.gateway,
}));
import { deliveryAction } from "@/app/deliveries/actions";
import * as actions from "@/app/actions";
import { POST as poll } from "@/app/api/payment-request/[id]/status/route";
import { POST as hints } from "@/app/api/hints/route";

const request: LocalPolicyRequest = {
  localAddress: "127.0.0.1",
  remoteAddress: "127.0.0.1",
  host: "127.0.0.1:43123",
  origin: "http://127.0.0.1:43123",
  method: "POST",
  port: 43123,
};
const databases: ReturnType<typeof supplierDb>[] = [];
function setup() {
  const db = supplierDb();
  databases.push(db);
  vi.spyOn(ledger, "getDb").mockReturnValue(db);
  const gateway = new FakeGateway();
  control.gateway = gateway;
  return { db, gateway };
}
function allowed<T>(fn: () => T, change: Partial<LocalPolicyRequest> = {}) {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("TALLY_LOCAL_LEDGER_EDITS", "on");
  vi.stubEnv("TALLY_NOW", NOW);
  return installLocalPolicyContext().run({ ...request, ...change }, fn);
}
function act(intent: string, reason = "", id = deliveryInput.id) {
  return allowed(() => deliveryAction({ id, intent, reason }));
}
function create() {
  expect(allowed(() => saveEntry("invoice", invoiceInput)).ok).toBe(true);
  expect(allowed(() => saveEntry("delivery", deliveryInput)).ok).toBe(true);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const db of databases.splice(0)) db.close();
});

test("default/production/missing context deny supplier entry, decisions, existing actions and API writes before database access", async () => {
  setup();
  vi.mocked(ledger.getDb).mockClear();
  for (const mode of ["test", "production", "development"]) {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv(
      "TALLY_LOCAL_LEDGER_EDITS",
      mode === "development" ? "off" : "on",
    );
    expect(saveEntry("invoice", invoiceInput).ok).toBe(false);
    expect(
      (
        await deliveryAction({
          id: deliveryInput.id,
          intent: "approve",
          reason: "",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await poll(new Request("http://127.0.0.1:43123"), {
          params: Promise.resolve({ id: "PRQ-TEST" }),
        })
      ).status,
    ).toBe(403);
    expect((await hints()).status).toBe(403);
    for (const action of Object.values(actions))
      await expect(
        (action as (form: FormData) => Promise<unknown>)(new FormData()),
      ).rejects.toThrow("access_denied");
  }
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("TALLY_LOCAL_LEDGER_EDITS", "on");
  expect(localLedgerAccess(true)).toBe(false);
  expect(saveEntry("delivery", deliveryInput).ok).toBe(false);
  expect(ledger.getDb).not.toHaveBeenCalled();
});

test.each([
  { origin: "https://attacker.example" },
  { origin: null },
  { remoteAddress: "192.168.1.1" },
  { localAddress: "0.0.0.0" },
  { host: "attacker.example:43123" },
  { method: "GET" },
])("spoofed/context request %j cannot create or decide", async (change) => {
  setup();
  vi.mocked(ledger.getDb).mockClear();
  expect(allowed(() => saveEntry("invoice", invoiceInput), change).ok).toBe(
    false,
  );
  expect(
    (
      await allowed(
        () =>
          deliveryAction({
            id: deliveryInput.id,
            intent: "evaluate",
            reason: "",
          }),
        change,
      )
    ).ok,
  ).toBe(false);
  expect(ledger.getDb).not.toHaveBeenCalled();
});

test("production remains denied even with explicit flag and trusted sockets", () => {
  setup();
  vi.mocked(ledger.getDb).mockClear();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TALLY_LOCAL_LEDGER_EDITS", "on");
  expect(
    installLocalPolicyContext().run(request, () =>
      saveEntry("invoice", invoiceInput),
    ).ok,
  ).toBe(false);
  expect(ledger.getDb).not.toHaveBeenCalled();
});

test("new-record supplier workflow: within terms, uncertain bank evidence, explicit hold, exact payment and old debt", async () => {
  const { db, gateway } = setup();
  expect(
    allowed(() =>
      saveEntry("invoice", {
        ...invoiceInput,
        id: "INV-9002",
        amount: "100.00",
        dueOn: "2026-12-01",
      }),
    ).ok,
  ).toBe(true);
  expect(allowed(() => saveEntry("delivery", deliveryInput)).ok).toBe(true);
  expect((await act("evaluate")).ok).toBe(true);
  expect(
    deliveryDetail(ledger.loadSnapshot(db), deliveryInput.id)!.balances.overdue,
  ).toBe(0);
  expect(
    deliveryDetail(ledger.loadSnapshot(db), deliveryInput.id)!.statusLabel,
  ).toBe("On credit");
  expect(allowed(() => saveEntry("invoice", invoiceInput)).ok).toBe(true);
  expect(
    ledger.loadSnapshot(db).customers.get("CUS-AHS" as never)!.hold.status,
  ).toBe("normal");
  const csv = new TextEncoder().encode(
    "Transaction Date,a,b,c,d,e,f,Debit,Credit,Payer\n17 Nov 2026,,,INV-9001 AH SENG,,,,,10.00,AH SENG\n",
  );
  expect(
    (await importBytes(db, csv, "supplier-fictional.csv", undefined, NOW)).ok,
  ).toBe(true);
  let model = deliveryDetail(ledger.loadSnapshot(db), deliveryInput.id)!;
  expect(model.credits).toHaveLength(1);
  expect(model.reviewAmount).toBe(1000);
  expect(model.balances).toMatchObject({ outstanding: 13840, overdue: 3840 });
  expect((await act("evaluate")).ok).toBe(true);
  expect(
    ledger.loadSnapshot(db).deliveries.get(deliveryInput.id as never)!.status,
  ).toBe("proposed_pay_first");
  expect(ledger.loadSnapshot(db).paymentRequests.size).toBe(0);
  expect((await act("approve")).ok).toBe(true);
  model = deliveryDetail(ledger.loadSnapshot(db), deliveryInput.id)!;
  expect(model.statusLabel).toBe("Pay-first approved");
  expect(model.request!.amount).toBe(22000);
  expect(model.request!.purpose).toEqual({
    kind: "pay_first",
    deliveryId: deliveryInput.id,
  });
  expect(
    gateway.calls.filter((call) => call.tool === "create_payment_request"),
  ).toHaveLength(1);
  gateway.markAmount(model.request!.hitpayRequestId!, cents(21999));
  gateway.markStatus(model.request!.hitpayRequestId!, "completed");
  expect((await act("check_payment")).ok).toBe(false);
  expect(
    ledger.loadSnapshot(db).deliveries.get(deliveryInput.id as never)!.status,
  ).toBe("pay_first");
  gateway.markAmount(model.request!.hitpayRequestId!, cents(22000));
  expect((await act("check_payment")).ok).toBe(true);
  const paid = ledger.loadSnapshot(db);
  model = deliveryDetail(paid, deliveryInput.id)!;
  expect(model.statusLabel).toBe("Released after verified payment");
  expect(model.balances).toMatchObject({ outstanding: 13840, overdue: 3840 });
  expect(paid.credits.size).toBe(1);
  expect(model.audit.map((event) => event.action)).toEqual(
    expect.arrayContaining([
      "delivery_created",
      "delivery_evaluated",
      "propose_hold",
      "approve_hold",
      "mcp_created",
      "webhook_confirmed",
    ]),
  );
  expect(
    paid.audit
      .filter((event) =>
        ["invoice_created", "delivery_created", "approve_hold"].includes(
          event.action,
        ),
      )
      .every(
        (event) =>
          event.actor.kind === "human" &&
          event.actor.name === "Local development operator",
      ),
  ).toBe(true);
  expect((await act("check_payment")).ok).toBe(true);
  expect(ledger.loadSnapshot(db)).toEqual(paid);
  expect(violations(paid)).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({
    integrity_check: "ok",
  });
});

test.each(["fake", "mcp"] as const)(
  "%s configured Settings and supplier workflow preserves money, human decisions and exact settlement",
  async (mode) => {
    for (const [key, value] of Object.entries({
      NODE_ENV: "development",
      TALLY_LOCAL_LEDGER_EDITS: "on",
      TALLY_DB_URL: ":memory:",
      TALLY_DEMO_DB_URL: ":memory:",
      TALLY_GATEWAY: mode,
      HITPAY_ENV: "sandbox",
      HITPAY_API_KEY: "dummy-workflow-api-key",
      HITPAY_WEBHOOK_SALT: "dummy-workflow-webhook-salt",
      HITPAY_MCP_URL: "https://sandbox-mcp.example.invalid/mcp",
      PUBLIC_URL: "https://tally-workflow.example.invalid",
      APP_URL: "http://127.0.0.1:43123",
      TALLY_TODAY: "2026-11-17",
      TALLY_NOW: NOW,
      TALLY_AUTO_APPROVE_REMAINDER: "on",
      HINTS_API_KEY: "",
    })) vi.stubEnv(key, value);

    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("This workflow must never access the network"),
    );
    const connect = vi.spyOn(Client.prototype, "connect").mockResolvedValue();
    const close = vi.spyOn(Client.prototype, "close").mockResolvedValue();
    const provider = new Map<string, {
      id: string;
      amount: string;
      currency: string;
      purpose: string;
      reference_number: string;
      checkout_url: string;
      status: "pending" | "completed";
    }>();
    // Only the SDK boundary is mocked: McpGateway serializes and parses every call.
    const callTool = vi.spyOn(Client.prototype, "callTool").mockImplementation(
      async ({ name, arguments: args = {} }) => {
        let row;
        if (name === "create_payment_request") {
          expect(args).toMatchObject({
            amount: expect.any(Number),
            currency: "SGD",
            purpose: expect.stringMatching(/^(remainder|pay_first)$/),
            reference_number: expect.stringMatching(/^TALLY-/),
            webhook: "https://tally-workflow.example.invalid/api/hitpay/webhook",
          });
          const amount = parseSgd(String(args.amount));
          if (!amount.ok) throw new Error("Invalid fixture amount");
          const id = `sandbox-workflow-${provider.size + 1}`;
          row = {
            id,
            amount: formatAmount(amount.value),
            currency: "SGD",
            purpose: String(args.purpose),
            reference_number: String(args.reference_number),
            checkout_url: `https://checkout.example.invalid/${id}`,
            status: "pending" as const,
          };
          provider.set(id, row);
        } else {
          expect(name).toBe("get_payment_request");
          row = provider.get(String(args.id));
          if (!row) throw new Error("Unknown fixture payment request");
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(row) }] };
      },
    );
    const env = readEnv();
    expect(env).toMatchObject({ gateway: mode, hitpayEnv: "sandbox", dbPath: ":memory:" });
    const gateway = mode === "mcp" ? new McpGateway(env) : new FakeGateway();
    control.gateway = gateway;
    const gatewayCalls = [
      vi.spyOn(gateway, "createInvoice"),
      vi.spyOn(gateway, "listInvoices"),
      vi.spyOn(gateway, "createPaymentRequest"),
      vi.spyOn(gateway, "getPaymentRequest"),
    ];
    const db = supplierDb();
    databases.push(db);
    vi.spyOn(ledger, "getDb").mockReturnValue(db);

    function saveSettings(threshold: Cents, minimumDays: number | null) {
      const before = ledger.loadSnapshot(db);
      const callsBefore = gatewayCalls.map((spy) => spy.mock.calls.length);
      const sdkBefore = [connect, callTool, close].map((spy) => spy.mock.calls.length);
      expect(allowed(() => savePolicy({
        threshold: formatAmount(threshold),
        ageMode: minimumDays === null ? "none" : "custom",
        minimumDays: minimumDays === null ? "" : String(minimumDays),
        expectedVersion: before.policyVersion,
      }))).toEqual({
        ok: true,
        policy: {
          threshold: formatAmount(threshold),
          minimumDays,
          version: before.policyVersion + 1,
        },
      });
      const after = ledger.loadSnapshot(db);
      const event = after.audit.at(-1)!;
      const settings = { overdueBalanceThreshold: threshold, overdueDaysThreshold: minimumDays };
      expect(event).toMatchObject({
        action: "policy_updated",
        entity: "settings",
        actor: { ...operator, access: "loopback_development" },
        before: { ...before.settings, version: before.policyVersion },
        after: { ...settings, version: before.policyVersion + 1 },
      });
      expect(after).toEqual({
        ...before,
        seq: before.seq + 1,
        settings,
        policyVersion: before.policyVersion + 1,
        audit: [...before.audit, event],
      });
      expect(gatewayCalls.map((spy) => spy.mock.calls.length)).toEqual(callsBefore);
      expect([connect, callTool, close].map((spy) => spy.mock.calls.length)).toEqual(sdkBefore);
      expect(network).not.toHaveBeenCalled();
      expect(violations(after)).toEqual([]);
    }
    async function submit(
      action: (form: FormData) => Promise<unknown>,
      fields: Record<string, string>,
      message: string,
    ) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      await expect(allowed(() => action(form))).rejects.toThrow(
        `/review?status=${encodeURIComponent(message)}`,
      );
    }
    async function pollPayment(payment: PaymentRequest, outcome: string) {
      const response = await allowed(() => poll(
        new Request(`http://127.0.0.1:43123/api/payment-request/${payment.id}/status`, { method: "POST" }),
        { params: Promise.resolve({ id: payment.id }) },
      ));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ outcome });
    }
    function completePayment(payment: PaymentRequest, amount: Cents) {
      expect(payment.hitpayRequestId).toBeTruthy();
      if (gateway instanceof FakeGateway) {
        gateway.markAmount(payment.hitpayRequestId!, amount);
        gateway.markStatus(payment.hitpayRequestId!, "completed");
      } else {
        const row = provider.get(payment.hitpayRequestId!);
        expect(row).toBeDefined();
        row!.amount = formatAmount(amount);
        row!.status = "completed";
      }
    }

    create();
    expect(allowed(() => saveEntry("invoice", {
      ...invoiceInput, id: "INV-9002", amount: "100.00", dueOn: "2026-11-01",
    })).ok).toBe(true);
    expect(allowed(() => saveEntry("delivery", {
      ...deliveryInput, id: "DLV-9002", amount: "50.00", scheduledFor: "2026-11-19",
    })).ok).toBe(true);
    const csv = new TextEncoder().encode(
      "Transaction Date,a,b,c,d,e,f,Debit,Credit,Payer\n17 Nov 2026,,,INV-9001 AH SENG,,,,,10.00,AH SENG\n17 Nov 2026,,,INV-9002 AH SENG,,,,,20.00,AH SENG\n",
    );
    expect((await importBytes(db, csv, "combined-fictional.csv", operator, NOW)).ok).toBe(true);
    const imported = ledger.loadSnapshot(db);
    expect(imported.credits.size).toBe(2);
    expect(imported.suggestions.size).toBe(2);
    expect([...imported.allocations.values()].map((row) => row.state)).toEqual(["suggested", "suggested"]);
    expect(deliveryDetail(imported, deliveryInput.id)!.balances).toMatchObject({ outstanding: 13840, overdue: 13840 });
    expect(deliveryDetail(imported, deliveryInput.id)!.reviewAmount).toBe(3000);
    expect(imported.deliveries.get(deliveryInput.id as never)!.status).toBe("on_credit");
    expect(imported.paymentRequests.size).toBe(0);

    saveSettings(cents(2000), null);
    expect(gatewayCalls.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    expect((await act("evaluate")).ok).toBe(true);
    const proposed = ledger.loadSnapshot(db);
    expect(proposed.deliveries.get(deliveryInput.id as never)!.status).toBe("proposed_pay_first");
    expect(proposed.paymentRequests.size).toBe(0);
    expect(proposed.audit.find((event) => event.action === "propose_hold")!.after).toMatchObject({ policyVersion: 1 });
    for (const suggestion of imported.suggestions.values()) {
      await submit(actions.approveAction, { suggestionId: suggestion.id }, "Approved.");
    }
    const approved = ledger.loadSnapshot(db);
    const selected = [...approved.allocations.values()].find((row) => row.invoiceId === invoiceInput.id)!;
    const unselected = [...approved.allocations.values()].find((row) => row.invoiceId === "INV-9002")!;
    expect(selected).toMatchObject({ state: "approved", amount: 1000, approvedBy: operator });
    expect(unselected).toMatchObject({ state: "approved", amount: 2000, approvedBy: operator });
    expect(approved.invoices.get(invoiceInput.id as never)!.remaining).toBe(2840);
    expect(approved.invoices.get("INV-9002" as never)!.remaining).toBe(8000);
    await submit(actions.commitAction, { allocationId: selected.id }, "Allocations reconciled.");
    const committed = ledger.loadSnapshot(db);
    expect(committed.allocations.get(selected.id)!.state).toBe("reconciled");
    expect(committed.allocations.get(unselected.id)).toEqual(unselected);
    expect(committed.invoices).toEqual(approved.invoices);
    expect(committed.credits).toEqual(approved.credits);
    expect(violations(committed)).toEqual([]);

    expect((await act("approve")).ok).toBe(true);
    await submit(actions.requestRemainderAction, { invoiceId: invoiceInput.id }, "Payment request ready.");
    const held = ledger.loadSnapshot(db);
    const deliveryPayment = [...held.paymentRequests.values()].find((row) => row.purpose.kind === "pay_first")!;
    const remainder = [...held.paymentRequests.values()].find((row) => row.purpose.kind === "remainder")!;
    expect(held.paymentRequests.size).toBe(2);
    expect(deliveryPayment).toMatchObject({ amount: 22000, status: "pending", purpose: { kind: "pay_first", deliveryId: deliveryInput.id } });
    expect(remainder).toMatchObject({ amount: 2840, status: "pending", purpose: { kind: "remainder", invoiceId: invoiceInput.id } });
    expect(held.customers.get("CUS-AHS" as never)!.hold).toMatchObject({
      status: "pay_first", deliveryId: deliveryInput.id, approvedBy: operator,
    });
    expect(gatewayCalls[2]).toHaveBeenCalledTimes(2);
    await submit(actions.requestRemainderAction, { invoiceId: invoiceInput.id }, "Payment request ready.");
    expect(ledger.loadSnapshot(db)).toEqual(held);
    expect(gatewayCalls[2]).toHaveBeenCalledTimes(2);

    // A now-ineligible policy must not undo an approved hold or alter pending obligations.
    saveSettings(cents(50000), 7);
    const awaiting = ledger.loadSnapshot(db);
    await pollPayment(remainder, "pending");
    expect(ledger.loadSnapshot(db)).toEqual(awaiting);
    completePayment(remainder, cents(2840));
    await pollPayment(remainder, "applied");
    const invoicePaid = ledger.loadSnapshot(db);
    expect(invoicePaid.invoices.get(invoiceInput.id as never)).toMatchObject({ total: 3840, allocated: 3840, remaining: 0, status: "paid" });
    expect(invoicePaid.invoices.get("INV-9002" as never)).toEqual(awaiting.invoices.get("INV-9002" as never));
    expect(invoicePaid.customers).toEqual(awaiting.customers);
    expect(invoicePaid.deliveries).toEqual(awaiting.deliveries);
    expect(invoicePaid.paymentRequests.get(remainder.id)!.status).toBe("completed");
    expect(invoicePaid.paymentRequests.get(deliveryPayment.id)).toEqual(deliveryPayment);
    const remainderCredit = [...invoicePaid.credits.values()].find((row) => row.source.kind === "hitpay_webhook")!;
    expect(remainderCredit).toMatchObject({ amount: 2840, unallocated: 0, source: { paymentRequestId: remainder.id } });
    expect([...invoicePaid.allocations.values()].find((row) => row.creditId === remainderCredit.id)).toMatchObject({
      amount: 2840, state: "reconciled",
      approvedBy: { kind: "system", via: "verified_remainder_webhook", paymentRequestId: remainder.id },
    });
    expect(invoicePaid.receipts).toHaveLength(1);
    expect(invoicePaid.receipts[0]).toMatchObject({ hitpayRequestId: remainder.hitpayRequestId, source: "poll", outcome: "applied" });
    expect(violations(invoicePaid)).toEqual([]);
    await pollPayment(remainder, "applied");
    expect(ledger.loadSnapshot(db)).toEqual(invoicePaid);

    completePayment(deliveryPayment, cents(21999));
    await pollPayment(deliveryPayment, "amount_mismatch");
    const wrongAmount = ledger.loadSnapshot(db);
    expect(wrongAmount.deliveries).toEqual(invoicePaid.deliveries);
    expect(wrongAmount.customers).toEqual(invoicePaid.customers);
    expect(wrongAmount.invoices).toEqual(invoicePaid.invoices);
    expect(wrongAmount.credits).toEqual(invoicePaid.credits);
    expect(wrongAmount.allocations).toEqual(invoicePaid.allocations);
    expect(wrongAmount.paymentRequests).toEqual(invoicePaid.paymentRequests);
    expect(wrongAmount.receipts).toHaveLength(2);
    expect(wrongAmount.receipts.at(-1)).toMatchObject({ hitpayRequestId: deliveryPayment.hitpayRequestId, source: "poll", outcome: "amount_mismatch" });
    expect(wrongAmount.audit.at(-1)).toMatchObject({ action: "webhook_rejected", after: { why: "amount_mismatch" } });
    expect(violations(wrongAmount)).toEqual([]);
    await pollPayment(deliveryPayment, "amount_mismatch");
    expect(ledger.loadSnapshot(db)).toEqual(wrongAmount);

    completePayment(deliveryPayment, cents(22000));
    await pollPayment(deliveryPayment, "applied");
    const released = ledger.loadSnapshot(db);
    expect(released.deliveries.get(deliveryInput.id as never)!.status).toBe("released");
    expect(released.deliveries.get("DLV-9002" as never)).toEqual(held.deliveries.get("DLV-9002" as never));
    expect(released.customers.get("CUS-AHS" as never)!.hold).toEqual({ status: "normal" });
    expect(released.paymentRequests.get(deliveryPayment.id)!.status).toBe("completed");
    expect(released.invoices).toEqual(invoicePaid.invoices);
    expect(released.credits).toEqual(invoicePaid.credits);
    expect(released.allocations).toEqual(invoicePaid.allocations);
    expect(deliveryDetail(released, deliveryInput.id)!.balances.outstanding).toBe(8000);
    expect(released.receipts).toHaveLength(3);
    expect(released.receipts.filter((row) => row.outcome === "applied")).toHaveLength(2);
    expect(released.audit.slice(0, wrongAmount.audit.length)).toEqual(wrongAmount.audit);
    expect(released.audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "approve_hold", actor: operator }),
      expect.objectContaining({ action: "webhook_confirmed", entityId: deliveryInput.id, after: { status: "released", source: "poll" } }),
    ]));
    expect(released.audit.filter((event) => event.action === "policy_updated")).toHaveLength(2);
    expect(released.audit.filter((event) => event.actor.kind === "ai").every((event) => event.action === "hint_recorded")).toBe(true);
    await pollPayment(deliveryPayment, "applied");
    await pollPayment(remainder, "applied");
    expect(ledger.loadSnapshot(db)).toEqual(released);
    expect(violations(released)).toEqual([]);
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(gatewayCalls[0]).not.toHaveBeenCalled();
    expect(gatewayCalls[1]).not.toHaveBeenCalled();
    expect(gatewayCalls[2]).toHaveBeenCalledTimes(2);
    expect(gatewayCalls[3]).toHaveBeenCalledTimes(8);
    if (mode === "mcp") {
      expect(gateway).toBeInstanceOf(McpGateway);
      expect(provider.size).toBe(2);
      expect(callTool.mock.calls.map(([call]) => call.name)).toEqual([
        "create_payment_request", "create_payment_request",
        ...Array<string>(8).fill("get_payment_request"),
      ]);
      expect(connect).toHaveBeenCalledTimes(10);
      expect(close).toHaveBeenCalledTimes(10);
    } else {
      expect(callTool).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    }
    expect(network).not.toHaveBeenCalled();
  },
);

test("new invoices participate in reference matching and human-approved balances", async () => {
  const { db } = setup();
  create();
  const csv = new TextEncoder().encode(
    "Transaction Date,a,b,c,d,e,f,Debit,Credit,Payer\n17 Nov 2026,,,INV-9001 AH SENG,,,,,38.40,AH SENG\n",
  );
  await importBytes(db, csv, "new-invoice-payment.csv", undefined, NOW);
  const before = ledger.loadSnapshot(db);
  const suggestion = [...before.suggestions.values()][0];
  expect(suggestion.body).toMatchObject({
    rule: "R1",
    invoiceId: invoiceInput.id,
  });
  expect(before.invoices.get(invoiceInput.id as never)!.remaining).toBe(3840);
  expect(approveSuggestion(db, suggestion.id, null, undefined, NOW).ok).toBe(
    true,
  );
  expect(
    deliveryDetail(ledger.loadSnapshot(db), deliveryInput.id)!.balances
      .outstanding,
  ).toBe(0);
  expect(violations(ledger.loadSnapshot(db))).toEqual([]);
});

test.each(["reject", "override"])(
  "%s requires a reason and records a human exception that is not proposed again",
  async (intent) => {
    const { db } = setup();
    create();
    await act("evaluate");
    if (intent === "override") await act("approve");
    const before = ledger.loadSnapshot(db);
    expect((await act(intent)).ok).toBe(false);
    expect(ledger.loadSnapshot(db)).toEqual(before);
    expect(
      (
        await act(
          intent,
          "Agreed credit exception for the fictional restaurant",
        )
      ).ok,
    ).toBe(true);
    const after = ledger.loadSnapshot(db);
    const model = deliveryDetail(after, deliveryInput.id)!;
    expect(model.statusLabel).toBe("On credit · human exception");
    expect(model.exception!.evidence).toEqual({
      kind: "human_reason",
      reason: "Agreed credit exception for the fictional restaurant",
    });
    expect(model.balances.overdue).toBe(3840);
    expect((await act("evaluate")).ok).toBe(false);
    expect(ledger.loadSnapshot(db)).toEqual(after);
    expect(violations(after)).toEqual([]);
  },
);

test("gateway creation failure leaves a visible approved hold and cannot create duplicate retries", async () => {
  const { db, gateway } = setup();
  create();
  await act("evaluate");
  const spy = vi.spyOn(gateway, "createPaymentRequest").mockResolvedValue({
    ok: false,
    error: { code: "transport", detail: "Fixture timeout" },
  });
  const result = await act("approve");
  expect(result.ok).toBe(false);
  expect(result.message).toContain("unresolved");
  const model = deliveryDetail(ledger.loadSnapshot(db), deliveryInput.id)!;
  expect(model.delivery.status).toBe("pay_first");
  expect(model.request!.status).toBe("creating");
  expect(model.nextAction).toBe("Inspect unresolved request");
  const before = ledger.loadSnapshot(db);
  expect((await act("approve")).ok).toBe(false);
  expect(spy).toHaveBeenCalledOnce();
  expect(ledger.loadSnapshot(db)).toEqual(before);
});

test("stale delivery forms cannot approve, reject or override another delivery's hold", async () => {
  const { db } = setup();
  create();
  await act("evaluate");
  const proposed = ledger.loadSnapshot(db);
  for (const kind of [
    "approve_hold",
    "reject_hold",
    "override_hold",
  ] as const) {
    expect(
      ledger.run(
        db,
        {
          kind,
          customerId: "CUS-AHS" as never,
          expectedDeliveryId: "DLV-9999" as never,
          by: { kind: "human", name: "Local development operator" },
          reason: "Stale form",
        },
        NOW,
      ),
    ).toMatchObject({ ok: false, error: { code: "illegal_transition" } });
    expect(ledger.loadSnapshot(db)).toEqual(proposed);
  }
  expect((await act("approve")).ok).toBe(true);
  const approved = ledger.loadSnapshot(db);
  expect(
    ledger.run(
      db,
      {
        kind: "override_hold",
        customerId: "CUS-AHS" as never,
        expectedDeliveryId: "DLV-9999" as never,
        by: { kind: "human", name: "Local development operator" },
        reason: "Stale form",
      },
      NOW,
    ).ok,
  ).toBe(false);
  expect(ledger.loadSnapshot(db)).toEqual(approved);
});

test("entry storage failure retains state and permits a safe retry with the same reference", () => {
  const { db } = setup();
  const before = ledger.loadSnapshot(db);
  db.exec(
    "CREATE TRIGGER fail_supplier_audit BEFORE INSERT ON audit_event BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  expect(allowed(() => saveEntry("invoice", invoiceInput))).toMatchObject({
    ok: false,
    message: expect.stringContaining("retained"),
  });
  expect(ledger.loadSnapshot(db)).toEqual(before);
  db.exec("DROP TRIGGER fail_supplier_audit");
  expect(allowed(() => saveEntry("invoice", invoiceInput))).toMatchObject({
    ok: true,
    existing: false,
  });
  expect(allowed(() => saveEntry("invoice", invoiceInput))).toMatchObject({
    ok: true,
    existing: true,
  });
  expect(ledger.loadSnapshot(db).invoices.size).toBe(1);
  expect(
    ledger
      .loadSnapshot(db)
      .audit.filter((event) => event.action === "invoice_created"),
  ).toHaveLength(1);
});

test("a new fake gateway instance never reuses a persisted request ID", async () => {
  const { db, gateway } = setup();
  create();
  expect(
    (
      await requestRemainder(
        db,
        gateway,
        invoiceInput.id as never,
        undefined,
        NOW,
      )
    ).ok,
  ).toBe(true);
  expect(
    allowed(() => saveEntry("invoice", { ...invoiceInput, id: "INV-9002" })).ok,
  ).toBe(true);
  expect(
    (
      await requestRemainder(
        db,
        new FakeGateway(),
        "INV-9002" as never,
        undefined,
        NOW,
      )
    ).ok,
  ).toBe(true);
  const requests = [...ledger.loadSnapshot(db).paymentRequests.values()];
  expect(requests).toHaveLength(2);
  expect(requests.every((row) => row.status === "pending")).toBe(true);
  expect(new Set(requests.map((row) => row.hitpayRequestId)).size).toBe(2);
  expect(violations(ledger.loadSnapshot(db))).toEqual([]);
});

test("browser batch actions require explicit target IDs before opening the ledger", async () => {
  setup();
  vi.mocked(ledger.getDb).mockClear();
  for (const action of [
    actions.approvePreselectedAction,
    actions.commitAction,
  ]) {
    await expect(allowed(() => action(new FormData()))).rejects.toThrow(
      "selection_required",
    );
    expect(ledger.getDb).not.toHaveBeenCalled();
  }
});
