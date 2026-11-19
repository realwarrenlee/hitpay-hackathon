import { expect, test } from "vitest";
import { cents } from "@/domain/money";
import type { InvoiceId, IsoDate, ReferenceNumber } from "@/domain/ids";
import { createInvoiceArgs, createPaymentRequestArgs, isPrivateHttpUrl, mcpHeaders, McpGateway, paymentWebhook } from "@/server/hitpay/mcp";
import { centsFromMajor, parseInvoiceList, parsePaymentRequest, redactSecrets } from "@/server/hitpay/parse";

const documentedCreate = {
  id: "9ef68e2e-3569-4f69-9f68-04c7e4bb007c",
  name: "Harvey Friesen",
  email: "test@gmail.com",
  phone: "+65489505050",
  amount: "10.00",
  currency: "sgd",
  status: "pending",
  purpose: "Purpose_1747817845",
  reference_number: "1747817845",
  payment_methods: ["card"],
  url: "https://securecheckout.sandbox.hit-pay.com/payment-request/@qasg/9ef68e2e-3569-4f69-9f68-04c7e4bb007c/checkout",
  redirect_url: "https://google.com",
  webhook: "https://webhook.site/8cbdef58-cd15-441a-986d-9446235223ea",
  send_sms: true,
  send_email: true,
  allow_repeated_payments: false,
  expiry_date: "2025-05-26T15:10:00",
  created_at: "2025-05-21T16:57:25",
  updated_at: "2025-05-21T16:57:25",
};

test("a documented payment request becomes integer cents", () => {
  const envelope = { content: [{ type: "text", text: JSON.stringify(documentedCreate) }], isError: false };
  const parsed = parsePaymentRequest(envelope);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.amount).toBe(cents(1000));
  expect(parsed.value.status).toBe("pending");
  expect(parsed.value.id).toBe(documentedCreate.id);
  expect(parsed.value.referenceNumber).toBe("1747817845");
  expect(parsed.value.url).toContain("securecheckout.sandbox.hit-pay.com");
});

test("the online-payments example amount is 59900 cents and completed is distinct from other", () => {
  const parsed = parsePaymentRequest({
    id: "90f28b43-2cff-4f86-a29e-15697424b3e7",
    amount: "599.00",
    currency: "SGD",
    status: "failed",
    reference_number: "REF123",
    url: "https://securecheckout.sandbox.hit-pay.com/payment-request/@business/90f28b43/checkout",
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.amount).toBe(cents(59900));
  expect(parsed.value.status).toBe("other");
});

test("a live tool error stays a tool error and a bad amount is unparseable", () => {
  const error = parsePaymentRequest({
    content: [
      {
        type: "text",
        text: "Error: No query results for Payment Request #00000000-0000-0000-0000-000000000000\nCode: HITPAY_404\nSuggestion: Resource not found at /v1/payment-requests/00000000-0000-0000-0000-000000000000. Verify the ID is correct.",
      },
    ],
    isError: true,
  });
  expect(error).toMatchObject({ ok: false, error: { code: "tool_error" } });
  if (!error.ok) expect(error.error.detail).toContain("HITPAY_404");

  const bad = parsePaymentRequest({ ...documentedCreate, amount: "38.401" });
  expect(bad).toMatchObject({ ok: false, error: { code: "unparseable" } });
});

test("a documented invoice list keeps major units as cents", () => {
  const parsed = parseInvoiceList({
    data: [
      {
        id: "9e9be3fd-5652-4f2e-b19e-532c62cc18d2",
        invoice_number: "INV-CJHA-20250406",
        reference: "12456678",
        email: "test@gmail.com",
        currency: "sgd",
        amount: 100,
        invoice_date: "2025-04-06",
        due_date: "2025-04-06",
      },
    ],
    meta: { next_cursor: null },
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value).toEqual([{ hitpayInvoiceId: "9e9be3fd-5652-4f2e-b19e-532c62cc18d2", reference: "12456678", amount: cents(10000) }]);
});

const liveGet = {
  id: "a33ef016-c83e-4e24-b1ee-0f3bff230d5c",
  status: "pending",
  amount: "SGD 38.40",
  checkout_url: "https://checkout.sandbox.hit-pay.com/payment-request/@warren/a33ef016-c83e-4e24-b1ee-0f3bff230d5c/checkout",
  purpose: "Tally sandbox smoke",
  reference_number: "TALLY-SMOKE-1794907111135",
  payment_methods: ["PayNow"],
  created_at: "2026-11-17T17:18:33",
  updated_at: "2026-11-17T17:18:33",
};

const liveList = {
  payment_requests: [
    {
      id: "a33ef016-c83e-4e24-b1ee-0f3bff230d5c",
      amount: "SGD 38.40",
      status: "pending",
      purpose: "Tally sandbox smoke",
      reference_number: "TALLY-SMOKE-1794907111135",
      created_at: "2026-11-17T17:18:33",
    },
  ],
  total: 2,
  page: 1,
  last_page: 1,
};

const liveBalances = { balances: [{ currency: "SGD", available: "SGD 0.00" }] };

test("a live sandbox payment request uses SGD amounts and checkout_url", () => {
  const parsed = parsePaymentRequest(liveGet);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.amount).toBe(cents(3840));
  expect(parsed.value.status).toBe("pending");
  expect(parsed.value.referenceNumber).toBe("TALLY-SMOKE-1794907111135");
  expect(parsed.value.url).toBe(liveGet.checkout_url);
  expect(centsFromMajor(liveList.payment_requests[0]?.amount ?? "")).toEqual({ ok: true, value: cents(3840) });
  expect(centsFromMajor(liveBalances.balances[0]?.available ?? "")).toEqual({ ok: true, value: cents(0) });
  expect(centsFromMajor("USD 38.40")).toMatchObject({ ok: false, error: { code: "unparseable" } });
  expect(centsFromMajor("SGD -1.00")).toMatchObject({ ok: false, error: { code: "unparseable" } });
});

test("an empty sandbox invoice page uses cursor fields", () => {
  const parsed = parseInvoiceList({ invoices: [], next_cursor: null, per_page: 25 });
  expect(parsed).toEqual({ ok: true, value: [] });
});

test("an invoice amount may be a SGD string", () => {
  const parsed = parseInvoiceList({ data: [{ id: "inv-1", reference: "12456678", amount: "SGD 100.00" }] });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value[0]?.amount).toBe(cents(10000));
});

test("payment request arguments are the tool schema and carry no credential", () => {
  const args = createPaymentRequestArgs({
    referenceNumber: "TALLY-INV-104-1" as ReferenceNumber,
    amount: cents(3840),
    purpose: "remainder",
    expiresAt: "2026-11-24 23:59:59",
    webhookUrl: null,
  });
  expect(args).toMatchObject({
    currency: "SGD",
    purpose: "remainder",
    reference_number: "TALLY-INV-104-1",
    expiry_date: "2026-11-24 23:59:59",
  });
  expect(args).not.toHaveProperty("webhook");
  expect(JSON.stringify(args)).not.toContain("api-key");
  expect(JSON.stringify(args)).not.toContain("HITPAY");
  expect(paymentWebhook("https://books.example/")).toBe("https://books.example/api/hitpay/webhook");
  expect(paymentWebhook("http://127.0.0.1:43123")).toBeNull();
  expect(paymentWebhook("")).toBeNull();
  expect(isPrivateHttpUrl("http://10.1.1.1/hook")).toBe(true);
  expect(isPrivateHttpUrl("http://192.168.0.8/hook")).toBe(true);
  expect(isPrivateHttpUrl("http://172.16.0.1/hook")).toBe(true);
  expect(isPrivateHttpUrl("https://books.example/hook")).toBe(false);
  const headers = mcpHeaders("test-key");
  expect(headers.Authorization).toBe("Bearer test-key");
  expect(headers["x-hitpay-api-key"]).toBe("test-key");
  expect(headers["x-hitpay-environment"]).toBe("sandbox");
  const ten = createPaymentRequestArgs({
    referenceNumber: "TALLY-INV-104-1" as ReferenceNumber,
    amount: cents(10),
    purpose: "remainder",
    expiresAt: "2026-11-24 23:59:59",
    webhookUrl: "http://127.0.0.1:43123/api/hitpay/webhook",
  });
  expect(ten.amount).toBe(0.1);
});

test("the gateway refuses a missing key and the live host before any call", async () => {
  const missing = new McpGateway({ hitpayApiKey: "", hitpayMcpUrl: "https://hitpay-mcp.vercel.app/api/mcp", webhookSalt: "salt", publicUrl: "" });
  expect(await missing.listInvoices()).toEqual({ ok: false, error: { code: "transport", detail: "HITPAY_API_KEY is not set" } });
  const live = new McpGateway({ hitpayApiKey: "not-a-real-key", hitpayMcpUrl: "https://mcp.hit-pay.com/", webhookSalt: "salt", publicUrl: "" });
  const refused = await live.getPaymentRequest("req" as never);
  expect(refused.ok).toBe(false);
  if (!refused.ok) {
    expect(refused.error.code).toBe("transport");
    expect(refused.error.detail).toContain("Refusing the live HitPay MCP host");
    expect(refused.error.detail).not.toContain("not-a-real-key");
  }
});

test("secret text is masked before it can be printed", () => {
  expect(redactSecrets("header x-hitpay-api-key=sandbox-key-value failed", ["sandbox-key-value"])).toBe("header x-hitpay-api-key=[redacted] failed");
});

test("create invoice args satisfy the required tool fields", () => {
  const args = createInvoiceArgs({
    invoiceId: "INV-104" as InvoiceId,
    customerName: "ABC Catering",
    amount: cents(50000),
    dueOn: "2026-11-30" as IsoDate,
  });
  expect(args.invoice_number).toBe("INV-104");
  expect(args.currency).toBe("SGD");
  expect(args.customer_email).toBe("billing@example.com");
  expect(args.send_email).toBe(false);
});
