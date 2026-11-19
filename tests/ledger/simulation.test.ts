import { afterEach, describe, expect, test, vi } from "vitest";
import { freshDb, fixture, NOW } from "../helpers";
const control = vi.hoisted(() => ({
  mode: "fake" as "fake" | "mcp",
  gateway: null as unknown,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));
vi.mock("@/server/env", async (original) => {
  const actual = await original<typeof import("@/server/env")>();
  return {
    ...actual,
    readEnv: () => ({ ...actual.readEnv(), gateway: control.mode }),
  };
});
vi.mock("@/server/hitpay/current", () => ({
  currentGateway: () => control.gateway,
}));
import * as ledger from "@/server/ledger";
import { FakeGateway } from "@/server/hitpay/fake";
import {
  importBytes,
  approveSuggestion,
  requestRemainder,
} from "@/server/flow";
import { reviewModel } from "@/server/views";
import { simulatePayAction } from "@/app/actions";

afterEach(() => {
  vi.restoreAllMocks();
  control.mode = "fake";
});
async function checkout() {
  const db = freshDb();
  vi.spyOn(ledger, "getDb").mockReturnValue(db);
  const fake = new FakeGateway();
  // A facade has the cached adapter's methods without its constructor identity.
  const gateway = {
    createInvoice: fake.createInvoice.bind(fake),
    listInvoices: fake.listInvoices.bind(fake),
    createPaymentRequest: fake.createPaymentRequest.bind(fake),
    getPaymentRequest: fake.getPaymentRequest.bind(fake),
    markStatus: vi.fn(fake.markStatus.bind(fake)),
  };
  control.gateway = gateway;
  await importBytes(
    db,
    fixture("fixtures/dbs/demo.csv"),
    "demo.csv",
    undefined,
    NOW,
  );
  const suggestion = reviewModel(ledger.loadSnapshot(db)).cards.find(
    (row) => row.fileLine === 17,
  )!;
  approveSuggestion(db, suggestion.suggestionId!, null, undefined, NOW);
  await requestRemainder(db, gateway, "INV-104" as never, undefined, NOW);
  const request = [...ledger.loadSnapshot(db).paymentRequests.values()][0];
  const form = new FormData();
  form.set("id", request.hitpayRequestId!);
  return { db, gateway, form };
}
describe("simulated checkout mode guard", () => {
  test("cached fake adapters work across constructor identities and reconcile the exact remainder", async () => {
    const { db, gateway, form } = await checkout();
    expect(gateway).not.toBeInstanceOf(FakeGateway);
    await expect(simulatePayAction(form)).rejects.toThrow(
      "Payment%20recorded.",
    );
    expect(gateway.markStatus).toHaveBeenCalledOnce();
    expect(
      reviewModel(ledger.loadSnapshot(db)).invoices.find(
        (row) => row.id === "INV-104",
      )?.status,
    ).toBe("Paid");
    db.close();
  });
  test("sandbox mode cannot simulate a payment even when an adapter exposes simulation methods", async () => {
    const { db, gateway, form } = await checkout();
    control.mode = "mcp";
    await expect(simulatePayAction(form)).rejects.toThrow(
      "Simulated%20checkout%20is%20unavailable",
    );
    expect(gateway.markStatus).not.toHaveBeenCalled();
    expect(
      reviewModel(ledger.loadSnapshot(db)).invoices.find(
        (row) => row.id === "INV-104",
      )?.status,
    ).toBe("Partially paid");
    db.close();
  });
});
