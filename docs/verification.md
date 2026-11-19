# Verification and limitations

This guide owns actual check commands, what they establish and what remains unverified. Financial rule definitions are in [features](features.md). Use a disposable ledger for mutations; never reset or reseed the working ledger to make a test pass.

## Commands

Run from the project root. Scripts are defined in [`package.json`](../package.json).

| Command | Actual check/effect |
| --- | --- |
| `npm test` | All `tests/**/*.test.ts` through Vitest |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint; warnings are not configured as errors |
| `npm run check` | Type checking, lint, then all tests; required before a commit |
| `npm run check:record` | Same three checks through Node; saves `artifacts/check/{git-sha-or-ISO-timestamp}.txt` |
| `npm run test:props:long` | Model suite with 5,000 runs and 120-second timeout; default model check uses 200 runs |
| `npm run e2e` | In-memory 12-step Vitest integration demo with FakeGateway; **not browser automation** |
| `node spike/tamper-test.mjs` | Standalone good-signature, tamper and replay exercise |
| `npm run build` | Next.js production compilation, framework type/lint checks and route build |
| `npm run doctor` | Ledger invariants, selected DB/config, invoice count, configured allowlist and Git SHA; no network calls |
| `npm run ledger:dump -- --out artifacts/ledger.json` | Selected ledger's invoices, credits, suggestions, allocations, customers, deliveries, requests, receipts and audit as JSON |
| `npm run golden:update` | Rewrites the DBS golden JSON; review its diff rather than using it to accept a regression |
| `npm run smoke:sandbox` | Explicit remote sandbox smoke described below; not part of `check` |

Doctor/dump are non-mutating with respect to existing business records, but their common `getDb()` path initializes schema and bootstraps an empty database. Check the intended database file first; see [database initialization](architecture.md#database-selection-and-initialization). Doctor does not validate a listening port/PID, contact the MCP server or run SQLite `PRAGMA integrity_check`. Dump omits some internal configuration/cache tables and is not a byte-for-byte SQLite backup.

## Coverage and its limits

| Location | Existing coverage |
| --- | --- |
| [`tests/domain/`](../tests/domain/) | Matching, money properties, conservation, state/hold rules and related invariants |
| [`tests/import/`](../tests/import/) | DBS parsing, physical line numbers, debit-only exclusion and golden fixture |
| [`tests/ledger/`](../tests/ledger/) | Audit append-only triggers and fake checkout/simulation restrictions |
| [`tests/model/`](../tests/model/) | Random command sequences with invariant checks |
| [`tests/settings/`](../tests/settings/) | Currency/day validation, age/threshold properties, policy persistence/migration, audit rollback, stale versions and local access guards |
| [`tests/hitpay/`](../tests/hitpay/), [`tests/webhook/`](../tests/webhook/) | Allowlist, result parsing, public callback arguments, signatures, tampering, settlement and replay/polling behavior |
| [`tests/hints/`](../tests/hints/) | Model-response parsing, fallback, token/alias constraints, explanations and cache behavior with controlled clients |
| [`tests/dashboard/`](../tests/dashboard/) | Derived balances and distinction between proposed and approved holds |
| [`tests/architecture/`](../tests/architecture/) | SQL/environment boundaries and domain purity |
| [`tests/demo/spec-demo.test.ts`](../tests/demo/spec-demo.test.ts) | Import twice, approve short payment, request remainder, approve hold, settle remainder without clearing hold, reject tamper, release correct delivery and reject duplicate effects |

The actual model generates import, write-off, commit and approve commands, then checks the final snapshot. It does not generate the entire payment/hold command catalog previously proposed; some generated approvals have no suggestions available. Dedicated suites and the offline demo exercise additional flows. More runs increase sampling, not the scope of generated actions.

The [invariant checkers](../src/domain/invariants.ts) cover the [I1–I10/C1–C3 rule families](features.md#audit-and-invariant-vocabulary) through concrete snapshot assertions. In particular, I5 checks allocation edges visible in audit records; it is not an exhaustive reconstruction of every hold/delivery transition. I6 checks selected object/audit relationships rather than proving every historical row change had a complete event. A clean doctor is useful evidence, not a full audit or security proof.

Existing fixtures are `demo.csv`, `identical-rows.csv`, `debits-mixed.csv`, `bad-amount.csv` under [`fixtures/dbs/`](../fixtures/dbs/) and a synthetic event under [`fixtures/webhooks/`](../fixtures/webhooks/). No `real-redacted.csv`, `tests/arbitraries.ts`, `scripts/demo-path.ts`, `scripts/drive.ts` or committed Playwright suite exists.

## Browser and sandbox validation

For a manual/browser check, start an isolated instance using [demo instructions](demo.md). Check overview, import/reimport, review/undo/commit, customer and invoice pages, Settings save/conflict/default-locked mode, Audit and driver checkout/release. Inspect stored state and audit as well as the UI. A route returning 200 alone does not prove its mutations work. Browser tools may be used locally but are not a project dependency or an `e2e` guarantee.

`smoke:sandbox` skips when `HITPAY_API_KEY` is empty. With credentials it lists tools, **creates a S$38.40 sandbox request**, fetches it, lists invoices and tests signatures locally. It does not take a payment, receive a real webhook or settle the working ledger. A passing smoke therefore proves connectivity/request parsing, not paid checkout or externally delivered callbacks. No sandbox command is needed for documentation-only changes.

For stronger sandbox proof, use a dedicated ledger, real sandbox checkout and `get_payment_request` confirmation; verify webhook/poll source, exact ledger outcome and audit. Never use fake checkout or a synthetic signed notice as real payment evidence. `scripts/send-webhook.ts` refuses MCP mode, but its generated request ID is not the ID stored by an existing fake checkout; it is not a dependable happy-path simulation command. Use the UI's simulated checkout or the tested in-memory demo instead.

## Recorded evidence

Previous checks recorded 134 tests across 19 files, type/lint/build, the 5,000-run model check, ten browser routes, unchanged ledger hash/counts and five passing sandbox smoke checks. These are dated prior measurements, not fresh live-payment verification. Local logs may be absent in a checkout.

`check:record` saves ignored test logs. The offline demo overwrites ignored `artifacts/demo-path/ledger.json` and `evidence/demo-path.json` with fictional test state. `artifacts/` (except its README), `evidence/`, browser output, local SQLite files/sidecars and secrets are ignored. Screenshots are optional; keep or remove local copies as needed. Review outputs for credentials and financial data before sharing them.

## Known limitations

- **Access:** no production authentication, verified owner identity or tenant isolation. The numeric Settings editor has dedicated local guards; this does not authenticate the other business actions/routes. Production fake-gateway and policy-write restrictions are intentional.
- **Settlement binding:** remote amount/ID binding remains incomplete on the webhook path. The exact findings are owned by [integrations](integrations.md#webhooks-and-status-checks), not assumed away by passing tests.
- **Request recovery:** a gateway failure can leave a `creating` row or an approved hold with no usable checkout. There is no implemented ten-minute abandonment, automatic stale-row cleanup, pending-request supersession or external-call crash recovery. `superseded`/`abandoned` type names do not constitute those workflows. Repeated retries can create additional requests. Inspect state rather than deleting ledger records.
- **Existing proposals:** saving policy does not withdraw/re-evaluate proposals; approve-hold uses the existing proposal state. Review an old proposal before approving after a policy change.
- **Dates/data:** policy date defaults to 17 November 2026 and does not advance automatically. Bootstrap delivery is fixed at 18 November 2026. Bank parser and cross-export dedupe limitations are documented in [integrations](integrations.md#dbs-csv).
- **Persistence/deployment:** local Node SQLite requires a writable persistent filesystem. Turso/Vercel deployment and distributed workers have not been implemented or validated. Fake gateway state does not survive a process restart.
- **Provider proof:** a real paid QR, external webhook delivery, current provider export layouts and judging eligibility are not established by this documentation review. Provider behavior still needs direct verification.
- **Warnings:** previous checks report the QR `<img>` ESLint warning and the Vite configuration advisory. Node SQLite may also emit an experimental warning depending on the Node version.

These are recorded limitations, not application changes made during documentation cleanup. Stripe, other-bank adapters and broader product ideas remain [unimplemented scope](features.md#unimplemented-scope).
