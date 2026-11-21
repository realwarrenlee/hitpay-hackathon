# Hackathon demo

Use fictional data and a disposable ledger. The complete automated story is [`tests/demo/spec-demo.test.ts`](../tests/demo/spec-demo.test.ts).

## Safe offline proof

```sh
npm run e2e
```

This runs in memory with FakeGateway and asserts the financial flow, tamper rejection and replay idempotency. It writes local test evidence; it does not start a browser or touch the selected runtime ledger. See [verification](verification.md) for the full checks.

## Prepare a browser demonstration

Stop any existing Tally instance using port 43123. In a new PowerShell terminal at the project root, select a fresh database explicitly:

```powershell
$demoLedger = Join-Path $env:TEMP ('tally-demo-' + [guid]::NewGuid().ToString('N') + '.db')
$env:TALLY_DB_URL = $demoLedger
$env:TALLY_DEMO_DB_URL = $demoLedger
$env:TALLY_GATEWAY = 'fake'
$env:APP_URL = 'http://127.0.0.1:43123'
$env:HITPAY_ENV = 'sandbox'
$env:HITPAY_MCP_URL = 'https://hitpay-mcp.vercel.app/api/mcp'
# Whitespace is treated as blank and overrides .env even in Windows PowerShell.
$env:HITPAY_API_KEY = ' '
$env:HITPAY_WEBHOOK_SALT = ' '
$env:PUBLIC_URL = ' '
$env:HINTS_API_KEY = ' '
$env:TALLY_TODAY = '2026-11-17' # Fixed fake-fixture policy date, not the wall clock.
$env:TALLY_NOW = ' '
$env:TALLY_AUTO_APPROVE_REMAINDER = 'on'
$env:TALLY_LOCAL_LEDGER_EDITS = 'on' # Required for Settings AND supplier actions.
npm run dev
```

The existing `.env` and working ledger stay untouched; process variables select this isolated demonstration and declare its ledger disposable under the [Settings safeguards](features.md#settings). The ledger opt-in is required even if only editing Settings. First database access bootstraps the fictional world automatically. No reset or seed command is needed. Open [127.0.0.1:43123](http://127.0.0.1:43123), then `/api/health` to verify the temporary path and five invoices. The fake gateway's remote state is process-local; keep the same server running throughout the payment demonstration.

## One story, about three minutes

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | On Import, upload `fixtures/dbs/demo.csv` | Six new credits |
| 2 | Upload the identical file again | Zero new, six already imported |
| 3 | On Review, open the Review drawer for bank line 17 (`ABC CAT 104`, S$461.60) | R3 suggestion against S$500.00 INV-104; S$38.40 shortfall and reason |
| 4 | Choose Approve allocation and confirm | INV-104 becomes partially paid; customer CUS-ABC has a proposed hold for DLV-201 |
| 5 | Request the exact S$38.40 remainder | Checkout link and copyable reminder; this is separate from the delivery payment |
| 6 | On `/customer/CUS-ABC`, approve the proposed hold | Delivery becomes pay-first and gets its own S$220.00 request |
| 7 | Open `/driver/DLV-201`, follow checkout and complete the **simulated** payment | Driver shows Released; customer hold returns to normal |
| 8 | Reopen the invoice and Audit | The old S$38.40 is still outstanding if its separate link was not paid; audit records approval and release |

Do not press **Check Cut-Off** before approving the short payment: the full S$500.00 would already qualify and obscure the story. Do not pay the remainder before approving the hold: that can remove the overdue amount needed to propose it. If you pay the remainder after the hold is approved, it pays the invoice but does not lift that delivery's hold. The automated demo exercises this additional distinction before paying the delivery.

The fictional bootstrap is defined in [`ledger.ts`](../src/server/ledger.ts):

| Customer / alias | Invoices |
| --- | --- |
| ABC Catering / `ABC CAT` | INV-104 S$500.00 |
| Ah Seng Eating House / `AH SENG` | INV-105 S$500.00; INV-110 S$180.00 |
| Tan BK Café / `TAN BK` | INV-041 S$500.00; INV-042 S$300.00 |

DLV-201 is ABC's S$220.00 delivery on 18 November 2026. Initial policy is S$30.00 with no grace period. New bootstrap fixtures give INV-104 a due date of 11 November, INV-105 13 November, INV-041/042 14 November and INV-110 5 December 2026. INV-110 is outstanding but within terms on the policy date. Existing ledgers are never backfilled with fictional due dates. The remaining CSV lines demonstrate alias, unique split, ambiguous amount-only, exact-reference and unmatched cases. Numbers and rules come from fixtures and code, not a presentation-only scenario.

## Optional Settings scene

Both fake and real sandbox preparations enable Settings on the same normal `npm run dev` server; no special command or restart is needed. Change the threshold from S$30.00 to S$35.00, choose **Save changes**, then **Cancel** in the human confirmation dialog: the saved policy must remain unchanged. Save again and **Confirm changes**, reload and inspect Activity. **Discard changes** clears unsaved edits. Optionally show a stale-client conflict. Restore S$30.00 and no grace period with confirmation before the payment story.

Saves affect future evaluations only, without evaluating deliveries, changing existing proposed/approved holds, approving/releasing a delivery or rewriting financial history. [Settings](features.md#settings) owns validation, access and compatibility-alias details. Sandbox credentials do not lock Settings; the explicit ledger opt-in remains required in both modes. Never proxy or tunnel this unauthenticated server.

## Real HitPay sandbox workflow

This is the canonical local setup for **real sandbox checkout followed by polling**, including Settings. The delivery-payment path has a [recorded successful sandbox run](verification.md#completed-sandbox-payment-and-release); the additional invoice-remainder checkout below remains a procedure to verify separately. Use only a sandbox account/key/salt and fictional records. Stop the fake or other Tally instance on port 43123. In a fresh PowerShell terminal at the project root (after `npm install`):

```powershell
$demoLedger = Join-Path $env:TEMP ('tally-sandbox-' + [guid]::NewGuid().ToString('N') + '.db')
$env:TALLY_DB_URL = $demoLedger
$env:TALLY_DEMO_DB_URL = $demoLedger
$env:TALLY_GATEWAY = 'mcp'
$env:TALLY_LOCAL_LEDGER_EDITS = 'on'
$env:HITPAY_ENV = 'sandbox'
$env:HITPAY_MCP_URL = 'https://hitpay-mcp.vercel.app/api/mcp'
# Hidden input: no literal credentials in shell history or edits to .env.
$env:HITPAY_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'HitPay sandbox API key' -AsSecureString)).Password
$env:HITPAY_WEBHOOK_SALT = [System.Net.NetworkCredential]::new('', (Read-Host 'HitPay sandbox webhook salt' -AsSecureString)).Password
$env:APP_URL = 'http://127.0.0.1:43123'
# Spaces override inherited/.env values even in Windows PowerShell; Tally trims them.
$env:PUBLIC_URL = ' ' # Omit callback; use local Check payment status.
$env:HINTS_API_KEY = ' '
$env:TALLY_NOW = ' ' # Use real audit timestamps, not an inherited fixed timestamp.
$env:TALLY_AUTO_APPROVE_REMAINDER = 'on'
$sgZone = [System.TimeZoneInfo]::FindSystemTimeZoneById('Singapore Standard Time')
$policyDate = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $sgZone).Date
$env:TALLY_TODAY = $policyDate.ToString('yyyy-MM-dd')
# Keep these displayed dates for the fictional entry forms below.
[pscustomobject]@{
    PolicyDate = $env:TALLY_TODAY
    InvoiceIssuedOn = $policyDate.AddDays(-31).ToString('yyyy-MM-dd')
    InvoiceDueOn = $policyDate.AddDays(-1).ToString('yyyy-MM-dd')
    DeliveryScheduledFor = $policyDate.AddDays(1).ToString('yyyy-MM-dd')
} | Format-List
npm run dev
```

Credentials are still held in process environment for the app; do not print/export that environment or capture secrets in logs/screenshots. This does not overwrite `.env` or touch the working ledger. Open [127.0.0.1:43123](http://127.0.0.1:43123) and `/api/health`; verify the new temporary path and five bootstrapped fictional invoices before making changes. `PUBLIC_URL` is blank for this polling workflow; setting it would neither unlock network access nor relax the same-origin, Host, socket or proxy restrictions. Do not use the live `mcp.hit-pay.com` host.

Use the printed dates, not the fixed November fake-fixture dates: request expiry is **policy date +7 days for an invoice remainder, +1 day for pay-first**, at `23:59:59`; it is not based on wall-clock audit time or delivery date. Refresh this setup's policy date before a later-day run; use a new disposable ledger rather than resetting history or recreating unresolved requests.

1. Open Settings and perform the [save/cancel/confirm scene](#optional-settings-scene); finish at S$30.00 with no grace period. No payment or hold should be created by saving.
2. Import `fixtures/dbs/demo.csv`. Approve **only bank line 19**, the S$800.00 split for Tan BK Café (`CUS-TBK`), clearing INV-041/042. Reconcile that credit with human confirmation if desired; approval already changes balances. Leave unrelated credits untouched.
3. On Deliveries choose **New invoice**: Tan BK Café, `INV-9201`, **S$38.40**, using the printed `InvoiceIssuedOn` and `InvoiceDueOn`. Choose **New delivery**: the same customer, `DLV-9201`, **S$220.00**, using `DeliveryScheduledFor`. Creation alone leaves the delivery on credit without a request.
4. Open the new delivery, **Evaluate delivery**, review the S$38.40 overdue evidence and **Approve pay-first** with human confirmation. The approved obligation is **S$220.00 for DLV-9201**, not S$258.40 and not the invoice debt.
5. Open INV-9201 and request its separate **S$38.40 remainder** link, but do not pay it yet. Return to the delivery; its held state and S$220.00 request remain separate.
6. Open the delivery's real HitPay sandbox checkout and complete it using the provider-supported sandbox payment method/test details, never live payment credentials. Return to delivery detail and choose **Check payment status** (or let its driver page poll). A checkout redirect alone is not settlement: Tally must confirm remote completed status, identity, reference, SGD amount and purpose. Expect **Released after verified payment**, normal customer hold, and INV-9201 still owing **S$38.40**. Delivery settlement creates no invoice credit.
7. Now complete the separate invoice sandbox checkout and choose **Check payment status** on the invoice. With the configured auto-approval flag and unchanged exact remainder, expect INV-9201 paid via one approved/reconciled credit. Paying an invoice never substitutes for a held delivery's payment.
8. Inspect delivery/customer views and Activity; retain local evidence of remote completed status, `source: poll`, the exact release and invoice settlement in the disposable ledger/dump. Reload to confirm persisted results; the status button is offered only while a request is pending. A `pending`, mismatch or unresolved `creating` state is not success; do not reset history or create replacements to hide it. See [payment handling and recovery limits](features.md#payments-and-delivery-holds).

The [20 November sandbox run](verification.md#completed-sandbox-payment-and-release) confirmed the held-delivery payment and polling release while leaving the separate S$38.40 debt outstanding. It used different fictional record IDs from this repeatable setup. It did not pay that separate invoice or demonstrate actual inbound webhooks. [Integrations](integrations.md#tooling-evidence-and-remaining-provider-proof) owns the external contract and remaining provider-proof limits; no deployment, authentication or tunnelling is added here.

## Cleanup

After either demo, stop that instance. Run doctor/dump in the same terminal if needed while the temporary DB variables remain set, then close that terminal to discard the overrides and sandbox credentials. Retain useful evidence; delete only an explicitly disposable temporary database/output if no longer needed and no process uses it. Never reset/reseed or delete working-ledger records. No screenshot collection is required.

## Supplier workflow with new records

Use the [PowerShell preparation](#prepare-a-browser-demonstration), including `TALLY_LOCAL_LEDGER_EDITS=on`, then normal `npm run dev`. `npm run dev:supplier-demo` is an alternative explicit supplier opt-in. The Settings disposable-ledger marker alone does not enable these actions or real sandbox payments. Keep the server on loopback and do not tunnel it; plain Next.js does not supply trusted socket context. [Supplier access](features.md#supplier-entry-and-access) owns the guards.

This sequence works from the standard fictional bootstrap, without resetting existing financial records:

1. Import `fixtures/dbs/demo.csv`. On Review approve **only bank line 19**, the S$800.00 split for Tan BK Café's INV-041/042. Those fixture invoices now have no remaining balance. Do not approve unrelated credits for this scene.
2. On Deliveries choose **New invoice**: Tan BK Café (`CUS-TBK`), reference `INV-9101`, S$100.00, issue `2026-11-01`, due `2026-12-01`. Due date is required; the amount must be positive exact SGD.
3. Choose **New delivery**: Tan BK Café, reference `DLV-9101`, S$220.00, scheduled `2026-11-18`. Creation leaves it on credit with no payment request.
4. Open its delivery detail and **Evaluate delivery**. On policy date `2026-11-17`, the S$100.00 invoice is within terms: S$0.00 eligible overdue, no proposal.
5. Create a second invoice for Tan BK Café: `INV-9102`, S$38.40, issue `2026-10-17`, due `2026-11-16` (agreed 30-day term). Creating it does not itself approve or propose a hold.
6. Import `fixtures/dbs/supplier-review.csv`. Its S$10.00 credit has a possible INV-9102/TAN BK match. Leave it unapproved. Delivery detail shows payment evidence needing review; total outstanding remains S$138.40 and eligible overdue S$38.40. This is uncertainty about payment, not proof the customer has not paid.
7. **Evaluate delivery** again. The overdue balance exceeds the S$30.00 threshold, so Tally proposes pay-first. Review the policy, invoice evidence and pending credit.
8. Choose **Approve pay-first** and accept the explicit confirmation. The request is for **S$220.00 for this delivery**, not S$258.40 or the invoice debt. Alternatively enter a reason and reject the proposal; that records a human credit exception and does not collect payment.
9. Open **simulated checkout** and confirm simulated payment. Return to delivery detail and check status if needed. The delivery reads **Released after verified payment**; the old S$38.40 invoice and the S$100.00 within-terms invoice remain outstanding.
10. Inspect delivery Audit, customer invoices, Overview and Deliveries. The upcoming list includes the delivery with its scheduled date and actual released state. Repeating the same record submission opens the existing record; conflicting details for the reference are rejected.

The upcoming delivery list starts from the configured policy date; there are no date-filter controls. Entered references follow the existing invoice convention (`INV-` plus 3–6 digits) and the delivery convention (`DLV-` plus 3–9 digits). Use the same reference after a timeout. No edit/delete workflow is provided; financial history stays append-only.

The automated new-record acceptance scenario is in `tests/supplier/workflow.test.ts`; persistence, validation, dates and duplicate tests are in `tests/supplier/entries.test.ts`. The browser verification used an isolated fixture with two existing fictional customers and no seeded invoices/deliveries, created INV-9101/9102 and DLV-9101 through the forms, and separately retained its evidence under `artifacts/milestone-2/`. No normal ledger records were used.

## Review and activity controls

Open an individual credit's **Review** drawer to approve or reject its suggested allocation; ambiguous matches require an explicit radio invoice choice. Approved allocations retain **Undo** until reconciled. Whenever that credit has approved allocation IDs, choose **Reconcile** and confirm the credit and approved amount shown. This submits only that credit's existing approved allocation IDs through unchanged `commitAction`/`commit_approved`, finalizes those allocations and removes Undo. Approval has already affected invoice and credit balances; reconciliation does not change them again or touch other credits or original bank/invoice records. Bank credits has no bulk-action panel, mode switch, selection totals or row checkboxes; server/domain bulk commands remain without browser batch controls. Search, status badges and existing access guards remain; credit status tabs are not shown.

**Collect invoice balances** is always visible on Bank credits, showing outstanding balances and remainder links. Paid invoices remain in customer history. Use **Import bank file** on Bank credits to upload a statement. In Activity, search the newest-first history for identifiers, actors and meaningful reasons; dates display in Singapore time. Full technical evidence and original timestamps remain in the ledger and the separate operator `ledger:dump` export, not an expandable JSON record.
