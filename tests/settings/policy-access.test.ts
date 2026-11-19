import { spawnSync } from "node:child_process";
import { describe, expect, test, afterEach, vi } from "vitest";
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
afterEach(() => vi.unstubAllEnvs());
describe("loopback policy access boundary", () => {
  test("the demo launcher refuses a production process even with opt-in", () => {
    const result = spawnSync(
      process.execPath,
      ["--require", "tsx/cjs", "scripts/dev-local.ts", "--policy-edits"],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          TALLY_LOCAL_POLICY_EDITS: "on",
        },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "The local development launcher cannot run in production.",
    );
  });

  test("disabled by default even with real socket context", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TALLY_LOCAL_POLICY_EDITS", undefined);
    expect(
      installLocalPolicyContext().run(request, () => localPolicyAccess(true)),
    ).toBe(false);
  });
  test("explicit development opt-in permits only verified loopback requests", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TALLY_LOCAL_POLICY_EDITS", "on");
    const context = installLocalPolicyContext();
    expect(context.run(request, () => localPolicyAccess(true))).toBe(true);
    expect(localPolicyAccess(true)).toBe(false);
  });
  test.each(["production", "test", ""])(
    "never permits %s regardless of opt-in",
    (mode) => {
      vi.stubEnv("NODE_ENV", mode);
      vi.stubEnv("TALLY_LOCAL_POLICY_EDITS", "on");
      expect(
        installLocalPolicyContext().run(request, () => localPolicyAccess(true)),
      ).toBe(false);
    },
  );
  test.each([
    { remoteAddress: "192.168.1.10" },
    { localAddress: "0.0.0.0" },
    { host: "attacker.example:43123" },
    { origin: "https://attacker.example" },
    { origin: null },
    { method: "GET" },
  ])("rejects spoofed/network/cross-origin context", (change) =>
    expect(trustedLoopbackRequest({ ...request, ...change }, true)).toBe(false),
  );
  test("read-only access check does not require POST", () =>
    expect(
      trustedLoopbackRequest(
        { ...request, method: "GET", origin: null },
        false,
      ),
    ).toBe(true));
});
