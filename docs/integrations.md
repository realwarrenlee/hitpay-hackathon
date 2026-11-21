# Integrations and configuration

This reference describes the current adapters and environment handling. [Features](features.md) owns financial decisions; [architecture](architecture.md) owns persistence and module boundaries.

## HitPay sandbox MCP

[`mcp.ts`](../src/server/hitpay/mcp.ts) implements [`HitPayGateway`](../src/server/hitpay/gateway.ts) using `@modelcontextprotocol/client` v2 and Streamable HTTP. The configured default endpoint is `https://hitpay-mcp.vercel.app/api/mcp`. It sends `Authorization: Bearer <key>`, `x-hitpay-api-key` and `x-hitpay-environment: sandbox`. The application rejects a non-sandbox `HITPAY_ENV` and URLs containing `mcp.hit-pay.com`. Those are application guards, not a general guarantee about arbitrary custom endpoints.

The runtime [allowlist](../src/server/hitpay/allowlist.ts) permits only `create_invoice`, `list_invoices`, `create_customer`, `create_payment_request`, `get_payment_request`, `list_charges` and `get_charge_detail`. Every other tool name is refused before transport, including refunds, transfers, beneficiaries and deletes. Tool discovery lists names for the explicit smoke command; the full provider toolset is never delegated to the hints model.

| Gateway operation | Current request/response handling |
| --- | --- |
| Create payment request | Sends numeric major-unit `amount` derived from exact formatted cents, `currency: SGD`, purpose, reference and `expiry_date`; requires an ID and checkout URL in the parsed result |
| Get payment request | Sends `{id}`; reads returned ID, status, amount, currency and purpose as well as reference |
| Create invoice | Sends invoice number, amount/currency, customer name, placeholder `billing@example.com`, `send_email: false` and due date; adapter method only, no application seeding workflow |
| List invoices | Sends `per_page: "25"`; supports an array or `invoices`/`data` envelope; does not implement pagination/synchronization |

[`parse.ts`](../src/server/hitpay/parse.ts) unwraps structured or JSON-text MCP results, recognizes tool errors, validates shapes with Zod and converts decimal amounts to cents. It preserves returned identity/purpose and reads currency from the explicit currency field or a currency-prefixed amount. Missing currency/purpose cannot authorize settlement. Creation also validates the returned amount, SGD currency, reference and purpose against its input. It accepts `SGD 38.40`, decimal strings and finite decimal major-unit numbers; non-SGD currency prefixes and malformed amounts are rejected. `checkout_url` takes precedence over `url`. Gateway errors distinguish `tool_not_allowed`, `transport`, `tool_error` and `unparseable`; key/salt values are masked in error detail.

The application formats expiry as `YYYY-MM-DD 23:59:59`: policy date +7 days for a remainder, policy date +1 day for pay-first. Pay-first expiry is **not derived from the delivery's scheduled date**. The fixed fake-fixture policy date can produce expired real requests; use today's Singapore date and appropriately dated fictional records in the [canonical real sandbox workflow](demo.md#real-hitpay-sandbox-workflow). It includes Settings under normal `npm run dev`, real checkout and status polling, with no public callback needed.

The gateway chooses the webhook field from `PUBLIC_URL`, not the orchestration's `APP_URL` value: a supplied origin passing the current public-host check gets `/api/hitpay/webhook` appended; otherwise the webhook field is omitted. Sandbox credentials and `PUBLIC_URL` do not deny Settings, but neither grants network access. The custom local launcher still rejects forwarded traffic. Actual inbound webhooks need separately validated reachable infrastructure; deployment is outside this local walkthrough. Do not proxy/tunnel the unauthenticated demonstration server.

`FakeGateway` is process-local and creates `/pay/fake/[id]` checkout URLs. Simulated checkout marks the fake adapter complete and sends a signed notice through the same handler. It requires configured fake mode and the simulation method. Fake mode is refused in production, and a process restart loses the fake adapter's in-memory remote state even though the SQLite ledger persists. Simulated request IDs use server-side UUIDs so new requests do not collide with persisted IDs after adapter restart. Missing fake remote state cannot authorize settlement or display a successful simulated payment. Supplier simulation/poll actions also require the explicit local supplier guard.

## Webhooks and status checks

[`src/app/api/hitpay/webhook/route.ts`](../src/app/api/hitpay/webhook/route.ts) reads raw bytes with `arrayBuffer()` before [`handleWebhook`](../src/server/hitpay/webhook.ts) parses JSON.

1. Require a 64-character hex `Hitpay-Signature`; verify HMAC-SHA256 over the raw body using equal-length buffers and `timingSafeEqual`. Invalid signatures are audited and return HTTP 401.
2. Validate JSON request ID, reference and decimal-string amount. Optional `event_type`, `status`, `currency` and `purpose` are checked when supplied: the supported type is `payment_request.completed`, status must be completed, currency SGD and purpose the stored kind. Missing optional event fields do not substitute for remote proof. Malformed payloads return 400 with rejection evidence. Legacy form-encoded callbacks are unsupported.
3. Query `get_payment_request` for the supplied ID. Require remote completion and agreement among event, remote response and local request: returned ID and stored HitPay ID, reference, SGD currency (explicit or amount-prefixed), amount and purpose (`remainder` or `pay_first`). Missing remote currency/purpose fails closed. Inconsistent confirmations produce audited rejection receipts without financial effects. HTTP 200 alone does not establish settlement.
4. Pass the verified confirmation to the common transactional ledger path. Recheck stored ID, pending status and amount; pay-first also requires the linked delivery's amount and payment-request ID. Existing exact hold/release and remainder approval gates still apply. A changed invoice remainder retains the existing human-review credit behavior; it is distinct from an unverifiable payment.

Polling uses the local stored HitPay ID and the same remote checks, with `source: poll`. Webhooks use `source: webhook`. Applied settlements/review credits share `hitpay:{requestId}` deduplication. Rejections have separate evidence keys: identical rejection evidence deduplicates while a corrected valid confirmation may still settle. Earlier nonterminal receipts can be retried, with updated receipt hash/source; prior audit entries remain append-only.

### Tooling evidence and remaining provider proof

Reviewed on 19 November 2026: the official [developer plugin configuration](https://github.com/hit-pay/claude-code-plugin/blob/main/.mcp.json) uses `https://hitpay-mcp.vercel.app/api/mcp`, `x-hitpay-api-key` and `x-hitpay-environment`, matching this application's transport. The separate official [hosted business MCP server](https://hitpayapp.com/mcp) uses OAuth at `mcp.hit-pay.com` and is live-only. Keep its refusal; it is not a sandbox alternative. The [Build with AI guide](https://docs.hitpayapp.com/apis/guide/build-with-ai) distinguishes the developer plugin, Agent Skills, CLI and hosted MCP server.

Existing `npm run smoke:sandbox` evidence is in local `artifacts/milestone-1/sandbox-smoke.txt`: five checks passed—tool discovery, request creation, pending request read-back, invoice listing and local signature/tamper verification—through this application's installed v2 MCP client and allowlist where applicable. This demonstrates developer-endpoint MCP use during this implementation; it does not establish historical use of Claude Code, Agent Skills, CLI, Grok Bot or Grok Build, or organiser acceptance of that evidence.

The smoke creates an unpaid S$38.40 sandbox request; it does not complete checkout, receive an actual inbound webhook or release a delivery. A separate [completed sandbox payment and release](verification.md#completed-sandbox-payment-and-release) was verified on 20 November 2026 through the actual hosted checkout, PayNow simulator, independent MCP read-back and Tally's polling settlement path. Its retained evidence establishes the exact held-delivery payment and release, duplicate protection and persistence after restart. The [real sandbox walkthrough](demo.md#real-hitpay-sandbox-workflow) describes how to exercise these flows; its additional invoice-remainder payment is not covered by that recorded provider success.

Actual inbound webhook delivery remains unverified: polling does not prove callback delivery, and fake/mocked checks are not provider proof. Ask the organiser whether demonstrated developer-endpoint MCP calls meet the brief and whether the actual AI tooling satisfies the Grok requirement; never claim eligibility from configuration alone.

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
| `HITPAY_ENV` | Runtime defaults to `sandbox`; any other value throws. Settings requires an explicit trimmed `sandbox`, not the unset default |
| `HITPAY_API_KEY` | Empty; sandbox key required for usable MCP calls, unnecessary for fake mode; does not deny Settings |
| `HITPAY_MCP_URL` | Plugin endpoint above; known live hostname is rejected |
| `HITPAY_WEBHOOK_SALT` | Fake mode fallback `tally-fake-salt`; required for MCP mode; does not deny Settings |
| `TALLY_GATEWAY` | Explicit trimmed `fake` or `mcp`; otherwise MCP if a key exists, fake if absent. Settings requires the explicit value. Example selects sandbox MCP and requires sandbox credentials; production refuses fake |
| `TALLY_DB_URL` | `file:./data/tally.db`; Node SQLite path, not Turso; must be explicit for Settings editing |
| `TALLY_DEMO_DB_URL` | Empty; operator declaration that the selected ledger is disposable, not content inspection or a filename heuristic. Must match explicit `TALLY_DB_URL` under the [Settings safeguards](features.md#settings); never the default working ledger. Does not enable supplier actions |
| `APP_URL` | `http://127.0.0.1:43123`; app/fake-checkout origin |
| `PUBLIC_URL` | Empty; controls whether MCP payment requests include a callback. Does not deny Settings or grant network access; leave blank for local polling |
| `TALLY_TODAY` | `2026-11-17`; fixed policy date, not automatically advanced |
| `TALLY_NOW` | Current ISO time when unset; optional fixed timestamp for demonstrations |
| `TALLY_AUTO_APPROVE_REMAINDER` | On by default; only exact `off` disables after trimming; no Settings mutation |
| `TALLY_LOCAL_POLICY_EDITS` | Obsolete; no longer grants Settings access. See [Settings](features.md#settings) for the normal `npm run dev` gate |
| `TALLY_LOCAL_LEDGER_EDITS` | Off unless exactly `on` (untrimmed) in development; required for both Settings and supplier actions with `npm run dev`, also enabled by `dev:supplier-demo`. Requires [trusted supplier request context](features.md#supplier-entry-and-access); Settings also needs its disposable-ledger gate |
| `HINTS_API_URL` | `https://api.openai.com/v1`; Responses endpoint base |
| `HINTS_API_KEY` | Empty; optional external hints calls |
| `HINTS_MODEL` | Configured default `gpt-6.1-terra`; select a model available to your provider |
| `HINTS_TIMEOUT_MS` | Positive integer milliseconds, default `20000` |
| `TALLY_STRIPE` | `on` maps to a config boolean only; no Stripe adapter or Payment Element exists |
| `TALLY_PROP_RUNS` | Model test override, default 200; long command sets 5000 |

[`.env.example`](../.env.example) contains safe placeholders. `.env` and overrides are ignored. There is no `TALLY_DB_AUTH_TOKEN` integration. The dev launcher fixes host/port rather than reading `PORT`; production `npm start` uses 43123 through its package script. Restart after changing database/gateway credentials because connections/adapters are cached.
