import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { readLocalLedgerMode } from "@/server/env";
import {
  installLocalPolicyContext,
  type LocalPolicyRequest,
} from "@/server/local-request-context";
import {
  localPolicyAccess,
  trustedLoopbackRequest,
} from "@/server/local-policy-access";
const request: LocalPolicyRequest = {
  localAddress: "127.0.0.1",
  remoteAddress: "127.0.0.1",
  host: "127.0.0.1:43123",
  origin: "http://127.0.0.1:43123",
  method: "POST",
  port: 43123,
};
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("TALLY_GATEWAY", "fake");
  vi.stubEnv("TALLY_DB_URL", "file:./artifacts/policy-test.db");
  vi.stubEnv("TALLY_DEMO_DB_URL", "file:./artifacts/policy-test.db");
  vi.stubEnv("HITPAY_API_KEY", "");
  vi.stubEnv("HITPAY_WEBHOOK_SALT", "");
  vi.stubEnv("HITPAY_ENV", "sandbox");
  vi.stubEnv("HITPAY_MCP_URL", "");
  vi.stubEnv("PUBLIC_URL", "");
  vi.stubEnv("TALLY_LOCAL_POLICY_EDITS", undefined);
  vi.stubEnv("TALLY_LOCAL_LEDGER_EDITS", "on");
});
afterEach(() => vi.unstubAllEnvs());
describe.each(["fake", "mcp"])("%s loopback policy access boundary", (gateway) => {
  beforeEach(() => {
    vi.stubEnv("TALLY_GATEWAY", gateway);
    vi.stubEnv("HITPAY_API_KEY", gateway === "mcp" ? "fixture-sandbox-key" : "");
    vi.stubEnv("HITPAY_WEBHOOK_SALT", gateway === "mcp" ? "fixture-sandbox-salt" : "");
  });
  test.each([[[]], [["--policy-edits"]]])("the local launcher refuses production with flags %j", (flags) => {
    const result = spawnSync(
      process.execPath,
      ["--require", "tsx/cjs", "scripts/dev-local.ts", ...flags],
      {
        env: { ...process.env, NODE_ENV: "production", TALLY_LOCAL_POLICY_EDITS: "on" },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("The local development launcher cannot run in production.");
  });
  test("disabled without a disposable ledger designation even with real socket context", () => {
    vi.stubEnv("TALLY_DEMO_DB_URL", undefined);
    expect(installLocalPolicyContext().run(request, () => localPolicyAccess(true))).toBe(false);
  });
  test("normal development permits only verified loopback policy requests on the designated sandbox ledger", () => {
    const context = installLocalPolicyContext();
    expect(context.run(request, () => localPolicyAccess(true))).toBe(true);
    expect(context.run({ ...request, method: "GET", origin: null }, () => localPolicyAccess())).toBe(true);
    expect(localPolicyAccess(true)).toBe(false);
    expect(readLocalLedgerMode()).toBe(true);
  });
  test("sandbox credentials and a public callback do not disable local editing or grant network access", () => {
    vi.stubEnv("HITPAY_API_KEY", "fixture-sandbox-key");
    vi.stubEnv("HITPAY_WEBHOOK_SALT", "fixture-sandbox-salt");
    vi.stubEnv("PUBLIC_URL", "https://example.com");
    const context = installLocalPolicyContext();
    expect(context.run(request, () => localPolicyAccess(true))).toBe(true);
    expect(context.run({ ...request, remoteAddress: "192.168.1.10" }, () => localPolicyAccess(true))).toBe(false);
  });
  test.each([undefined, "off", "on"])("legacy policy flag %s does not control demo editing", (flag) => {
    vi.stubEnv("TALLY_LOCAL_POLICY_EDITS", flag);
    expect(installLocalPolicyContext().run(request, () => localPolicyAccess(true))).toBe(true);
  });
  test("normalizes explicit matching paths and accepts an explicitly disposable in-memory ledger", () => {
    vi.stubEnv("TALLY_DEMO_DB_URL", resolve("artifacts/policy-test.db"));
    expect(installLocalPolicyContext().run(request, () => localPolicyAccess(true))).toBe(true);
    vi.stubEnv("TALLY_DB_URL", ":memory:");
    expect(installLocalPolicyContext().run(request, () => localPolicyAccess(true))).toBe(false);
    vi.stubEnv("TALLY_DEMO_DB_URL", ":memory:");
    expect(installLocalPolicyContext().run(request, () => localPolicyAccess(true))).toBe(true);
  });
  test.each([
    ["NODE_ENV", "production"], ["NODE_ENV", "test"], ["NODE_ENV", ""],
    ["TALLY_GATEWAY", undefined], ["TALLY_GATEWAY", "invalid"],
    ["TALLY_LOCAL_LEDGER_EDITS", undefined], ["TALLY_LOCAL_LEDGER_EDITS", ""], ["TALLY_LOCAL_LEDGER_EDITS", "off"], ["TALLY_LOCAL_LEDGER_EDITS", " on "],
    ["HITPAY_ENV", "live"], ["HITPAY_ENV", undefined], ["HITPAY_ENV", ""],
    ["HITPAY_MCP_URL", "https://mcp.hit-pay.com/mcp"],
    ["TALLY_DB_URL", undefined], ["TALLY_DB_URL", ""],
    ["TALLY_DB_URL", "file:./artifacts/other-ledger.db"],
    ["TALLY_DEMO_DB_URL", ":memory:"],
    ["TALLY_DEMO_DB_URL", undefined], ["TALLY_DEMO_DB_URL", ""],
  ])("denies %s=%s even with inherited demo opt-ins", (key, value) => {
    vi.stubEnv(key, value);
    vi.stubEnv("TALLY_LOCAL_POLICY_EDITS", "on");
    expect(installLocalPolicyContext().run(request, () => localPolicyAccess(true))).toBe(false);
  });
  test.each(["file:./data/tally.db", "data/../data/tally.db", resolve("data/tally.db")])(
    "cannot designate the default working ledger as disposable: %s", (path) => {
      vi.stubEnv("TALLY_DB_URL", path);
      vi.stubEnv("TALLY_DEMO_DB_URL", path);
      vi.stubEnv("TALLY_LOCAL_POLICY_EDITS", "on");
      expect(installLocalPolicyContext().run(request, () => localPolicyAccess(true))).toBe(false);
    },
  );
  test.each([
    { remoteAddress: "192.168.1.10" },
    { localAddress: "0.0.0.0" },
    { host: "attacker.example:43123" },
    { origin: "https://attacker.example" },
    { origin: null },
    { method: "GET" },
  ])("rejects spoofed/network/cross-origin context", (change) => {
    expect(trustedLoopbackRequest({ ...request, ...change }, true)).toBe(false);
    expect(installLocalPolicyContext().run({ ...request, ...change }, () => localPolicyAccess(true))).toBe(false);
  });
  test("read-only access check does not require POST", () =>
    expect(trustedLoopbackRequest({ ...request, method: "GET", origin: null }, false)).toBe(true));
});
