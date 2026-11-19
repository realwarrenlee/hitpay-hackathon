import { describe, expect, test } from "vitest";
import { parsePolicyInput, MAX_POLICY_DAYS } from "@/domain/policy";
const payload = (
  threshold = "30.00",
  minimumDays = "",
  ageMode = "none",
  expectedVersion = 0,
) => ({ threshold, minimumDays, ageMode, expectedVersion });
describe("policy validation", () => {
  test.each([
    ["0", 0],
    ["0.01", 1],
    ["1,234.56", 123456],
    ["90071992547409.91", Number.MAX_SAFE_INTEGER],
  ])("exact SGD %s", (text, cents) => {
    const parsed = parsePolicyInput(payload(text));
    expect(parsed.ok && parsed.values.overdueBalanceThreshold).toBe(cents);
  });
  test.each([
    "",
    "-1",
    "NaN",
    "Infinity",
    "1.001",
    "1,2.00",
    "1,,000",
    "1e3",
    "S$30",
    "90071992547409.92",
    "+30",
  ])("rejects malformed amount %s", (text) =>
    expect(parsePolicyInput(payload(text)).ok).toBe(false),
  );
  test.each([
    "0",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    "",
    "1e2",
    String(MAX_POLICY_DAYS + 1),
  ])("rejects invalid custom days %s", (days) =>
    expect(parsePolicyInput(payload("30", days, "custom")).ok).toBe(false),
  );
  test("preserves explicit NULL separately from positive days", () => {
    expect(parsePolicyInput(payload())).toMatchObject({
      ok: true,
      values: { overdueDaysThreshold: null },
    });
    expect(parsePolicyInput(payload("50", "1", "custom"))).toMatchObject({
      ok: true,
      values: { overdueDaysThreshold: 1, overdueBalanceThreshold: 5000 },
    });
  });
  test.each([
    null,
    [],
    {},
    { ...payload(), expectedVersion: -1 },
    { ...payload(), expectedVersion: 0.5 },
    { ...payload(), autoApproveRemainder: true },
    { ...payload(), actor: { name: "Owner" } },
    { ...payload(), minimumDays: "0" },
  ])("malformed/extra fields do not pass", (input) =>
    expect(parsePolicyInput(input).ok).toBe(false),
  );
});
