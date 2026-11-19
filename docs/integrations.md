# Integrations and configuration

This reference describes the current adapters and environment handling. [Features](features.md) owns financial decisions; [architecture](architecture.md) owns persistence and module boundaries.

## HitPay sandbox MCP

[`mcp.ts`](../src/server/hitpay/mcp.ts) implements [`HitPayGateway`](../src/server/hitpay/gateway.ts) using `@modelcontextprotocol/client` v2 and Streamable HTTP. The configured default endpoint is `https://hitpay-mcp.vercel.app/api/mcp`. It sends `Authorization: Bearer <key>`, `x-hitpay-api-key` and `x-hitpay-environment: sandbox`. The application rejects a non-sandbox `HITPAY_ENV` and URLs containing `mcp.hit-pay.com`. Those are application guards, not a general guarantee about arbitrary custom endpoints.

The runtime [allowlist](../src/server/hitpay/allowlist.ts) permits only `create_invoice`, `list_invoices`, `create_customer`, `create_payment_request`, `get_payment_request`, `list_charges` and `get_charge_detail`. Every other tool name is refused before transport, including refunds, transfers, beneficiaries and deletes. Tool discovery lists names for the explicit smoke command; the full provider toolset is never delegated to the hints model.

| Gateway operation | Current request/response handling |
| --- | --- |
| Create payment request | Sends numeric major-unit `amount` derived from exact formatted cents, `currency: SGD`, purpose, reference and `expiry_date`; requires an ID and checkout URL in the parsed result |
| Get payment request | Sends `{id}`; reads status, amount and reference |
| Create invoice | Sends invoice number, amount/currency, customer name, placeholder `billing@example.com`, `send_email: false` and due date; adapter method only, no application seeding workflow |
| List invoices | Sends `per_page: "25"`; supports an array or `invoices`/`data` envelope; does not implement pagination/synchronization |

[`parse.ts`](../src/server/hitpay/parse.ts) unwraps structured or JSON-text MCP results, recognizes tool errors, validates shapes with Zod and converts decimal amounts to cents. It accepts `SGD 38.40`, decimal strings and finite decimal major-unit numbers; non-SGD currency prefixes and malformed amounts are rejected. `checkout_url` takes precedence over `url`. Gateway errors distinguish `tool_not_allowed`, `transport`, `tool_error` and `unparseable`; key/salt values are masked in error detail.

The application formats expiry as `YYYY-MM-DD 23:59:59`: policy date +7 days for a remainder, policy date +1 day for pay-first. Pay-first expiry is **not derived from the delivery's scheduled date**. The gateway chooses the webhook field from `PUBLIC_URL`, not the orchestration's `APP_URL` value: a supplied origin passing the current public-host check gets `/api/hitpay/webhook` appended; otherwise the webhook field is omitted. Without a reachable callback, use status polling. The custom local launcher rejects forwarded traffic, so a public callback deployment needs separate validation; do not tunnel the local Settings demonstration mode.

`FakeGateway` is process-local and creates `/pay/fake/[id]` checkout URLs. Simulated checkout marks the fake adapter complete and sends a signed notice through the same handler. It requires configured fake mode and the simulation method. Fake mode is refused in production, and a process restart loses the fake adapter's in-memory remote state even though the SQLite ledger persists.

## Webhooks and status checks

[`src/app/api/hitpay/webhook/route.ts`](../src/app/api/hitpay/webhook/route.ts) reads raw bytes with `arrayBuffer()` before [`handleWebhook`](../src/server/hitpay/webhook.ts) parses JSON.

1. Require a 64-character hex `Hitpay-Signature`; verify HMAC-SHA256 over the raw body using equal-length buffers and `timingSafeEqual`. Invalid signatures are audited and return HTTP 401.
2. Validate JSON fields `payment_request_id`, `reference_number` and decimal-string `amount`. `event_type` and `status` are optional; there is no event-name/status filter on these fields. Malformed payloads are audited and return 400. Legacy form-encoded callbacks are not supported.
3. Query `get_payment_request` for the supplied ID. Remote status must be completed and its reference must equal the event reference. Otherwise record `not_completed` or `unknown_reference` and return 200.
4. Pass the signed event's amount and reference into shared settlement. Local reference lookup, amount/purpose decisions and receipt deduplication apply as described in [features](features.md#payments-and-delivery-holds). Valid requests generally return 200 with an outcome; HTTP 200 alone does not mean a payment was applied.

Polling obtains the local request's HitPay ID and uses the remote result's amount after checking its reference. Both paths record settlement `source` as `webhook` or `poll` and share the receipt key `hitpay:{requestId}`.

**Known binding gap:** the webhook branch does not compare the signed amount with the remotely returned amount. Domain settlement looks up the local request by reference without explicitly requiring its stored HitPay ID to equal the event ID. Therefore it would be inaccurate to claim complete remote amount/ID binding. These existing findings are retained here for follow-up; documentation cleanup does not change the handler.

## DBS CSV

The custom [`parseDbs`](../src/server/import/dbs.ts) parser is the sole installed bank adapter. It decodes UTF-8, removes a leading BOM, finds a row beginning `Transaction Date`, then reads fixed DBS-style positions (1-based):

| Data | Position/handling |
| --- | --- |
| Date | Column 1, `d Mon YYYY` |
| Reference | Nonempty columns 4–6 joined with spaces |
| Debit / credit | Columns 8 / 9; debit-only rows are counted and skipped |
| Payer | Header named `Payer`, otherwise column 10 |
| Amount | Leading apostrophe/thousands commas removed, then exact SGD parsing |
| Source evidence | Original 1-based physical file line, including preamble |

Blank lines are skipped. A missing header, invalid parsed credit date/amount or empty input produces an error with its file line before any import command runs. Rows containing `HITPAY` in reference/payer are flagged as payouts and not matched. A credit-bearing row is parsed even if its debit cell also has content; this is not a generic statement-format validator.

Batch ID is SHA-256 of the complete file bytes. This parser currently always emits `bankTxnId: null`; the generic ledger supports bank transaction IDs, but DBS does not extract one. Thus the current import key is `DBS:batch:{hash}:line:{fileLine}`. Reimporting identical bytes is idempotent. Same date/amount/reference rows without transaction IDs within a batch are kept separately and flagged `identical_row`. A changed export can create different keys for the same real transaction; cross-export deduplication is not proven.

Fixtures live in [`fixtures/dbs/`](../fixtures/dbs/). Quoted commas are supported by the small line parser, but it is not a complete multiline/escaped-quote CSV implementation. No representative real redacted export fixture is supplied. Treat other bank/export layouts as unverified.

## AI reference hints

[`read.ts`](../src/server/hints/read.ts) proposes customer names/invoice tokens and short explanations for R3/R4/R5 uncertainty. [`openai.ts`](../src/server/hints/openai.ts) sends a request to `{HINTS_API_URL}/responses` with bearer authorization, `model`, `instructions`, `input` and strict JSON-schema `text.format`. It does not send temperature/sampling parameters. An arbitrary endpoint described merely as Chat Completions-compatible may not implement this contract.

Reference requests include the raw bank reference, payer name, known invoice IDs and confirmed customer aliases/names. Explanation requests also include candidate IDs, formatted credit/open amounts, deterministic reason and confirmed aliases found in the text. These data leave the process when a hints key is configured; do not describe this as sending only the reference text.

Responses are validated with Zod; extra wire fields are stripped, unknown invoice tokens are dropped, and customer proposals must resolve to known aliases/names. The matcher still requires a confirmed alias in the original reference/payer text. Model tokens merge with regex tokens, capped at four. Explanations are limited to two sentences/400 characters and rejected when they mention an `INV-` ID outside the candidate set. These checks do not independently verify every natural-language statement.

Without a key, on timeout/transport failure or unusable output, regex reference parsing and deterministic reasons remain available. Each call defaults to a 20-second timeout. Jobs run with concurrency four. Import can await reference/explanation calls; the review screen separately fills missing explanations through `POST /api/hints`. Cache is per bank credit, and transport failures remain eligible for retry. Hints never supply financial amounts or approvals; the UI labels accepted explanatory text **AI**.

## Environment

[`env.ts`](../src/server/env.ts) reads application settings. It uses explicit defaults/guards; it is not a single Zod environment schema. Next.js loads root environment files; npm TypeScript scripts use `tsx --env-file-if-exists=.env`. Existing process variables take precedence over that file. The Node verification runner invokes checks directly and does not itself load `.env`.

| Variable | Default / actual effect |
| --- | --- |
| `HITPAY_ENV` | `sandbox`; any other value throws |
| `HITPAY_API_KEY` | Empty; required for usable MCP calls, unnecessary for fake mode |
| `HITPAY_MCP_URL` | Plugin endpoint above; known live hostname is rejected |
| `HITPAY_WEBHOOK_SALT` | Fake mode fallback `tally-fake-salt`; required for MCP mode |
| `TALLY_GATEWAY` | Explicit `fake` or `mcp`; otherwise MCP if a key exists, fake if absent. Example file explicitly selects fake. Production refuses fake |
| `TALLY_DB_URL` | `file:./data/tally.db`; Node SQLite path, not Turso |
| `APP_URL` | `http://127.0.0.1:43123`; app/fake-checkout origin |
| `PUBLIC_URL` | Empty; controls whether MCP payment requests include a callback |
| `TALLY_TODAY` | `2026-11-17`; fixed policy date, not automatically advanced |
| `TALLY_NOW` | Current ISO time when unset; optional fixed timestamp for demonstrations |
| `TALLY_AUTO_APPROVE_REMAINDER` | On by default; only exact `off` disables after trimming; no Settings mutation |
| `TALLY_LOCAL_POLICY_EDITS` | Off unless exact `on` in development; requires trusted launcher request context too |
| `HINTS_API_URL` | `https://api.openai.com/v1`; Responses endpoint base |
| `HINTS_API_KEY` | Empty; optional external hints calls |
| `HINTS_MODEL` | Configured default `gpt-6.1-terra`; select a model available to your provider |
| `HINTS_TIMEOUT_MS` | Positive integer milliseconds, default `20000` |
| `TALLY_STRIPE` | `on` maps to a config boolean only; no Stripe adapter or Payment Element exists |
| `TALLY_PROP_RUNS` | Model test override, default 200; long command sets 5000 |

[`.env.example`](../.env.example) contains safe placeholders. `.env` and overrides are ignored. There is no `TALLY_DB_AUTH_TOKEN` integration. The dev launcher fixes host/port rather than reading `PORT`; production `npm start` uses 43123 through its package script. Restart after changing database/gateway credentials because connections/adapters are cached.
