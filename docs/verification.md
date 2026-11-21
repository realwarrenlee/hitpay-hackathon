# Verification and limitations

This guide owns actual check commands, what they establish and what remains unverified. Financial rule definitions are in [features](features.md). Use a disposable ledger for mutations; never reset or reseed the working ledger to make a test pass.

## Commands

Run from the project root. Scripts are defined in [`package.json`](../package.json).

| Command | Actual check/effect |
| --- | --- |
| `npm test` | All `tests/**/*.test.{ts,tsx}` through Vitest |
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
| [`tests/supplier/`](../tests/supplier/) | New invoice/delivery validation, idempotency, atomic audit, fresh-process persistence, customer linkage, date filters, guarded actions/APIs, reasoned exceptions, stale forms, creation failures and complete new-record fake payment/release |
| [`tests/model/`](../tests/model/) | Random command sequences with invariant checks |
| [`tests/settings/`](../tests/settings/) | Currency/day validation, due-date/grace/threshold properties, policy persistence/migration, audit rollback, stale versions and local access guards |
| [`tests/hitpay/`](../tests/hitpay/), [`tests/webhook/`](../tests/webhook/) | Allowlist, result parsing, public callback arguments, signatures, tampering, settlement and replay/polling behavior |
| [`tests/hints/`](../tests/hints/) | Model-response parsing, fallback, token/alias constraints, explanations and cache behavior with controlled clients |
| [`tests/dashboard/`](../tests/dashboard/) | Derived balances and distinction between proposed and approved holds |
| [`tests/architecture/`](../tests/architecture/) | SQL/environment boundaries and domain purity |
| [`tests/demo/spec-demo.test.ts`](../tests/demo/spec-demo.test.ts) | Import twice, approve short payment, request remainder, approve hold, settle remainder without clearing hold, reject tamper, release correct delivery and reject duplicate effects |

The actual model generates import, write-off, commit and approve commands, then checks the final snapshot. It does not generate the entire payment/hold command catalog previously proposed; some generated approvals have no suggestions available. Dedicated suites and the offline demo exercise additional flows. More runs increase sampling, not the scope of generated actions.

The [invariant checkers](../src/domain/invariants.ts) cover the [I1–I10/C1–C3 rule families](features.md#audit-and-invariant-vocabulary) through concrete snapshot assertions. In particular, I5 checks allocation edges visible in audit records; it is not an exhaustive reconstruction of every hold/delivery transition. I6 checks selected object/audit relationships rather than proving every historical row change had a complete event. A clean doctor is useful evidence, not a full audit or security proof.

Existing fixtures are `demo.csv`, `identical-rows.csv`, `debits-mixed.csv`, `bad-amount.csv` under [`fixtures/dbs/`](../fixtures/dbs/) and a synthetic event under [`fixtures/webhooks/`](../fixtures/webhooks/). `supplier-review.csv` provides a fictional unreviewed S$10.00 supplier-scene credit. No `real-redacted.csv`, `tests/arbitraries.ts`, `scripts/demo-path.ts`, `scripts/drive.ts` or committed Playwright suite exists.

## Browser and sandbox validation

For a manual/browser check, start an isolated instance using [demo instructions](demo.md). Check overview, import/reimport, review/undo/commit, customer and invoice pages, Settings save/conflict/default-locked mode, Audit and driver checkout/release. Inspect stored state and audit as well as the UI. A route returning 200 alone does not prove its mutations work. Browser tools may be used locally but are not a project dependency or an `e2e` guarantee.

`smoke:sandbox` skips when `HITPAY_API_KEY` is empty. With credentials it lists tools, **creates a S$38.40 sandbox request**, fetches it, lists invoices and tests signatures locally. It does not take a payment, receive a real webhook or settle the working ledger. A passing smoke therefore proves connectivity/request parsing, not paid checkout or externally delivered callbacks. No sandbox command is needed for documentation-only changes.

For stronger sandbox proof, use a dedicated ledger, real sandbox checkout and `get_payment_request` confirmation; verify webhook/poll source, exact ledger outcome and audit. Never use fake checkout or a synthetic signed notice as real payment evidence. `scripts/send-webhook.ts` refuses MCP mode, but its generated request ID is not the ID stored by an existing fake checkout; it is not a dependable happy-path simulation command. Use the UI's simulated checkout or the tested in-memory demo instead.

## Completed sandbox payment and release

On 20 November 2026 (Singapore time), a new disposable ledger completed the real HitPay sandbox delivery-payment workflow. Funds were simulated; the hosted checkout, PayNow simulator and remote payment record were actual provider sandbox surfaces.

The evidence files below are retained locally under `artifacts/demo-continuous-20261120-2216/`. They are ignored outputs and may be absent in a fresh checkout.

| Measured result | Retained local evidence |
| --- | --- |
| Human-approved S$800 bank split settled INV-041/042 for S$500/S$300 | `01-reconciliation.json` |
| Human approval created an exact S$220 pay-first request for DLV-9401 | `03-decision.json` |
| Independent MCP reads preserved the same ID, SGD amount, reference and `pay_first` purpose as status changed from pending to completed | `provider-pending.json`, `provider-completed.json` |
| Tally's actual status check released the delivery through one applied `source: poll` receipt; repeating it changed no saved financial, receipt or audit rows | `after-settlement.json` |
| Supplier and driver remained Released after an actual application restart; INV-9401 still owed S$38.40; saved rows matched, invariants were empty and SQLite integrity was `ok` | `restart-proof.json`, `persistence-proof.json` |

The working and prior evidence ledgers retained their pre-run hashes. At this checkpoint, `npm run check` passed TypeScript, lint and 298 tests across 29 files, with the existing QR image warning and Vite advisory; see the recorded `check.txt` log.

The provider console-clean assertion failed on `WebSocket is already in CLOSING or CLOSED state.` That message remains in `04-payment.json`; the payment UI and independent completed read-back succeeded. No provider-error fix is claimed. Native confirmation dialogs were accepted and logged but are outside page-video capture.

This run proves the specific held-delivery sandbox checkout and polling release, not live funds, actual inbound webhook delivery, separate invoice-remainder settlement or production authentication. The summary `report.html` and machine-readable `run-proof.json` retain the run details. Older measurements below describe their original checkpoints.

## Recorded evidence

Milestone 2 (19 November 2026): baseline `check` passed 162 tests across 24 files; final `npm run check` passed **198 tests across 26 files**, with TypeScript and lint. Production build and the 5,000-run model suite passed. Existing QR image/Vite advisories remain. Six deliberately broken rules were detected and restored: mandatory due date, conflicting duplicate facts, trusted local context, stale delivery ID, human hold approval and fake request-ID uniqueness. No property runs or existing assertions were reduced.

Local evidence is in `artifacts/milestone-2/`: `baseline-check.txt`, `final-check.txt`, `final-build.txt`, `properties-long.txt`, six mutation logs, baseline/browser doctor logs, `http-access.txt`, the fictional `browser-ledger.json` and asserted `browser-outcome.json`. The normal ledger's before/after SHA-256, row counts and read-only SQLite integrity checks are identical. Its schema/data were not initialized through the application during this task. Doctor reports no violations on the preserved baseline copy and disposable supplier ledger; SQLite integrity is `ok`.

Edge browser verification created new invoices INV-9101/9102 and DLV-9101 through the forms on a separate ledger with two existing fictional customers and no invoices/deliveries. Missing due date was blocked; excess precision produced a server field error while retaining inputs. Evaluation with only the within-terms S$100 invoice kept credit open. After adding S$38.40 genuinely overdue debt and importing an unreviewed S$10 credit, evaluation proposed pay-first. Explicit approval created an exact S$220 fake request; simulated verified payment released DLV-9101 while S$138.40 total invoices (S$38.40 overdue) and the unallocated credit remained. A second delivery was created/evaluated on mobile and rejected with a recorded credit-exception reason. Its state remained on credit without collecting payment.

Today/Tomorrow filtering, Overview, delivery Audit, driver release, full-width desktop tables and mobile form/detail layouts were checked at 1280×720 and 390×844, in light and dark themes. Mobile document width remained 390px. Screenshots are under ignored `output/playwright/m2-*.png` and snapshots under `.playwright-cli/`. Plain `npm run dev` showed locked controls; an actual payment-poll POST and forwarded request returned HTTP 403. The supplier test suite also checks production denial, missing trusted context, foreign sockets/hosts/origins and denial before database access. The exact standard-bootstrap scene in the demo guide was also replayed in memory with the committed fixtures and fake gateway (`guide-check.json`): release, S$138.40 outstanding and S$38.40 overdue were asserted. This is local-demo verification, not production authentication or real-provider checkout proof.

Milestone 1 (19 November 2026): `npm run check` passed 162 tests across 24 files, with type checking and lint; production build, the 5,000-run model check and signature/tamper/replay spike passed. The existing QR image lint warning and Vite advisory remain. Four deliberate mutations were detected (due-day boundary, older-reference eligibility, signed amount verification and transactional request identity), then restored. New regression coverage includes legacy due-date migration, fresh-process persistence, partial payments, 120-day CSV import, verification mismatches, valid retries and preservation of old debt.

Local evidence is under `artifacts/milestone-1/`: baseline/final check and build logs, `properties-long.txt`, mutation logs, `baseline-doctor.txt`, `final-doctor.txt`, `browser-outcome.json`, `browser-ledger.json` and working-ledger before/after hash/count snapshots. The normal ledger's SHA-256 and row counts were unchanged; SQLite integrity checks returned `ok`. Doctor reported no violations on the preserved baseline copy and disposable browser ledger.

Browser verification used Edge with a separate fake-gateway ledger: import, short-payment approval, explicit hold approval, S$220 simulated checkout, verified driver release, S$38.40 old debt remaining and Audit. Desktop invoice layout and mobile Settings/unknown-date labels were inspected; the invoice card now fills available width. Screenshots are in ignored `output/playwright/m1-*.png`; snapshots are in ignored `.playwright-cli/`. INV-110's due date was set NULL only in the disposable browser fixture to exercise the legacy label. This was not a real provider checkout.

Sandbox MCP smoke passed five checks; a separate read-only fetch preserved ID, SGD currency, amount, purpose, reference and pending status in `sandbox-binding-readback.json`. This establishes developer-endpoint connectivity/create/get, not paid checkout or external webhook delivery. See [tooling evidence](integrations.md#tooling-evidence-and-remaining-provider-proof) for official-source comparison and eligibility limits.

The pre-Milestone-1 baseline recorded 134 tests across 19 files, type/lint/build, the 5,000-run model check, ten browser routes, unchanged ledger hash/counts and five passing sandbox smoke checks. These are dated prior measurements, not fresh live-payment verification. Local logs may be absent in a checkout.

`check:record` saves ignored test logs. The offline demo overwrites ignored `artifacts/demo-path/ledger.json` and `evidence/demo-path.json` with fictional test state. `artifacts/` (except its README), `evidence/`, browser output, local SQLite files/sidecars and secrets are ignored. Screenshots are optional; keep or remove local copies as needed. Review outputs for credentials and financial data before sharing them.

## Known limitations

- **Access:** no production authentication, verified owner identity or tenant isolation. Supplier create/reconciliation/decision actions, fake simulation and poll/hints POST routes now have explicit trusted-loopback guards and deny production. Settings keeps its independent guards. Signed webhooks use signature/remote verification. These demonstration restrictions are not production identity or tenant isolation.
- **Settlement binding:** local/remote/event ID, amount, reference, currency and purpose checks are implemented and tested; the [completed sandbox run](#completed-sandbox-payment-and-release) exercised one exact held-delivery request through polling. It does not establish actual inbound webhook delivery or every provider payment path. See [integrations](integrations.md#webhooks-and-status-checks) for the binding checks.
- **Request recovery:** a gateway failure can leave a `creating` row or an approved hold with no usable checkout. There is no implemented ten-minute abandonment, automatic stale-row cleanup, pending-request supersession or external-call crash recovery. `superseded`/`abandoned` type names do not constitute those workflows. Unresolved creating rows now block duplicate creation for that obligation and are displayed with the stored reference. Inspect remote state before operator-assisted recovery; no automatic recovery or attachment UI is implemented. Do not delete ledger records.
- **Existing proposals:** saving policy does not withdraw/re-evaluate proposals; approve-hold uses the existing proposal state. Review an old proposal before approving after a policy change.
- **Dates/data:** policy date defaults to 17 November 2026 and does not advance automatically. Bootstrap delivery is fixed at 18 November 2026. Bank parser and cross-export dedupe limitations are documented in [integrations](integrations.md#dbs-csv).
- **Persistence/deployment:** local Node SQLite requires a writable persistent filesystem. Turso/Vercel deployment and distributed workers have not been implemented or validated. Fake gateway payment state does not survive a process restart. New simulated request IDs are unique across adapter instances to prevent collision with persisted IDs; lost state is not treated as successful payment. An interrupted pending fake checkout cannot be resumed as provider proof.
- **Provider proof:** hosted PayNow sandbox payment and polling release are recorded above. Actual inbound webhook delivery, separate invoice-remainder settlement, current provider export layouts and judging eligibility remain outside that proof; local/fake checks do not establish those provider behaviors.
- **Warnings:** previous checks report the QR `<img>` ESLint warning and the Vite configuration advisory. Node SQLite may also emit an experimental warning depending on the Node version.

These are current limitations; Milestone 1 implemented due dates and stricter confirmation binding without production authentication. Milestone 2 adds the guarded supplier entry/delivery workflow, and the later sandbox run establishes the specific completed checkout and polling release described above. Stripe, other-bank adapters and broader product ideas remain [unimplemented scope](features.md#unimplemented-scope).

## UI/UX refinement verification

The UI refinement adds regression coverage for explicit selected-only batches (including valid positive cases, stale/duplicate/unknown/overlapping target rollback), accepted candidate display, unallocated verified receipts, genuine Overview tasks, date/time/plural formatting and same-timestamp audit ordering. Server-rendered component checks cover unselected defaults, a closed review drawer, structured matching evidence and warnings, activity metadata without technical payloads, separate delivery evidence, positive-balance invoice collection, six grouped sidebar destinations and meaningful empty states. Vitest transforms JSX for these checks and limits concurrent workers to four to avoid resource contention; property run counts, assertions and timeouts remain unchanged.

Local evidence is retained in `artifacts/ux-refinement/`: `check-final.txt`, `build.txt`, `doctor.txt`, `browser-ledger.json`, `browser-proof.txt`, `working-ledger-before.json`, `working-ledger-after.json` and `report.md`. `mutant-approve-target.txt` and `mutant-commit-target.txt` record deliberate removal of the selected-target restrictions causing regression failures; the implementation was restored. Browser screenshots are under `output/playwright/ux-before-*` and `ux-after-*`, with loading/network-failure captures named `ux-review-*`.

These checks use an isolated fictional ledger and FakeGateway. Render tests do not prove client interaction; browser checks separately exercise approval, rejection, selected reconciliation, drawer focus/Escape, filters, loading/network failure, responsive layouts and the fake S$220 delivery release while S$38.40 invoice debt remains. They do not establish real provider payment, screen-reader compatibility, all browser engines or production readiness. Existing integration limitations above still apply.

Individual-review cleanup (19 November 2026): browser batch controls and row checkboxes were replaced with Reconcile inside each credit's Review drawer. `npm run check` passed 222 tests across 29 files, with the existing QR image lint warning and Vite advisory. Added checks cover exact, partial and split per-credit IDs, locked controls, unrelated approvals, unchanged balances, repeat rejection and a partially finalized split. Deliberately omitting the second split ID failed the new regression; the implementation was restored before the passing full check.

Edge browser checks on the separate `artifacts/ux-cleanup/individual-review.db` exercised individual approval/reconciliation, confirmation cancellation, pending controls, a simulated network failure, stale submission rejection and both split allocations. Invoice/credit/delivery records stayed unchanged during reconciliation, existing audit events were preserved, and only the chosen approvals were finalized. Search, no-results, desktop/tablet/mobile and light/dark layouts passed; a separate six-page desktop/mobile pass reported no console/page errors. Doctor found no invariant violations and read-only SQLite integrity returned `ok`. Evidence is retained under `artifacts/ux-cleanup/`: `individual-review-check.txt`, `individual-review-mutant.txt`, `individual-review-proof.json`, `individual-review-console.txt`, `individual-review-doctor.json` and `individual-*.png`. This is local fictional-data verification, not real HitPay checkout proof.

## Normal-development Settings verification

This records the earlier fake-only gate, superseded by [sandbox-enabled Settings](#sandbox-enabled-settings-verification) below.

19 November 2026: `npm run check` passed 250 tests across 29 files, including the existing financial properties, with the existing QR image warning and Vite advisory. Access/service regressions cover a legal disposable fake ledger without the old policy flag, missing/mismatched declarations, default-ledger exclusion, provider credentials, production, trusted request context and denial before database access. Removing the fake-only guard deliberately caused four regression failures; the guard was restored before the passing check.

Edge browser checks exercised the normal launcher's request path without policy-edit flags, using an isolated build directory, port 43129 and a fresh fictional ledger rather than disturbing the existing server. Confirmed threshold/grace saves, cancel/discard, invalid precision and stale-client reload passed on desktop/mobile. A save added one local-operator policy audit and version increment, preserving previous audit, invoices, credits, allocations, customers, deliveries and payment requests. Foreign-origin action replay was rejected (500); forwarded requests and supplier payment POSTs were denied (403). No page/console errors occurred in the UI checks. Real HitPay operations, public deployment and authentication were not tested or added.

Evidence is retained in `artifacts/local-policy-dev/`: `check.txt`, `mutant-fake-gate.txt`, `browser-proof.json`, `settings-desktop.png` and `settings-mobile.png`. The [demo guide](demo.md#prepare-a-browser-demonstration) is the setup reference; this proof does not certify arbitrary data as disposable.

## Sandbox-enabled Settings verification

19 November 2026: `npm run check` passed TypeScript, ESLint and 298 tests across 29 files, with the existing QR image warning and Vite advisory. Settings access/service tests cover both explicit fake and MCP modes, sandbox credentials, the required supplier opt-in, explicit sandbox environment, matching disposable paths, default-ledger exclusion, live-host/production denial and trusted-request checks. Validation, audit rollback and unchanged financial records are checked in both modes. The new access regressions failed against the old gate; deliberately removing the supplier opt-in then caused seven failures. The implementation was restored before the successful full check.

The combined supplier regression in `tests/supplier/workflow.test.ts` runs with FakeGateway and the real McpGateway adapter with its SDK connection/tool calls mocked. A fetch guard forbids network access. It covers policy changes before evaluation and during an approved hold, invoice/delivery creation, bank import, human approval and selected reconciliation, remainder request and confirmed polling, wrong-amount rejection, exact delivery release, audit, replay and invariants. Policy saves neither call a gateway nor change financial state; paying the remainder leaves the approved hold intact. These are controlled adapter tests, not HitPay payment proof.

Edge browser checks used the normal launcher's source without edit flags, changing only port/build configuration to avoid the existing server, with separate disposable fictional ledgers for fake and MCP modes. Both passed Settings save/confirmation cancel/discard, invalid precision, stale-client conflict/reload, desktop/mobile layout, supplier entry, delivery evaluation and cancelled hold approval. Each Settings save added one policy audit/version while preserving financial records. Fake mode also completed simulated delivery payment/release; MCP mode used dummy credentials and a loopback non-provider endpoint, and exercised a reasoned credit exception without payment calls. Foreign-origin replay was denied (500), forwarded requests were denied (403), and no UI page/console errors occurred. Both retained ledgers passed read-only SQLite integrity and domain invariant checks. The working ledger was not used.

Evidence is retained in `artifacts/sandbox-policy-dev/`: `check.txt`, `before-gate.txt`, `mutant-ledger-opt-in.txt`, `restored.txt`, `fake-browser-proof.json`, `mcp-browser-proof.json`, `browser-integrity.txt`, browser logs and screenshots. Browser helpers are `preview.cjs` and `browser-check.cjs`, each taking `fake` or `mcp`. No actual provider calls were made for this Settings change; its checks alone did not prove completed checkout or settlement. The separate [completed sandbox run](#completed-sandbox-payment-and-release) supplies delivery-payment and polling-release evidence. Actual inbound webhook delivery remains unverified.
