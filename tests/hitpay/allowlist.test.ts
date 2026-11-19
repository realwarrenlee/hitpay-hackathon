import { expect, test } from "vitest";
import { callTool } from "@/server/hitpay/mcp";

test("money-moving and delete tools never reach transport", async () => {
  let calls = 0;
  for (const name of ["create_refund", "create_transfer", "create_beneficiary", "delete_customer", "delete_invoice"]) {
    const result = await callTool(name, {}, async () => {
      calls += 1;
      return {};
    });
    expect(result).toEqual({ ok: false, error: { code: "tool_not_allowed", detail: name } });
  }
  expect(calls).toBe(0);
});

test("the allowlisted tools are named exactly", async () => {
  const blocked = await callTool("create_payment_request", { amount: "38.40" });
  expect(blocked.ok).toBe(false);
  if (!blocked.ok) expect(blocked.error.code).toBe("transport");
  const sent = await callTool("create_payment_request", { amount: "38.40" }, async () => ({ id: "hitpay_1" }));
  expect(sent).toEqual({ ok: true, value: { id: "hitpay_1" } });
});
