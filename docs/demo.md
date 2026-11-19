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
$env:TALLY_GATEWAY = 'fake'
$env:TALLY_TODAY = '2026-11-17'
$env:TALLY_AUTO_APPROVE_REMAINDER = 'on'
$env:TALLY_LOCAL_POLICY_EDITS = 'off'
$env:HINTS_API_KEY = ''
npm run dev
```

The existing `.env` and working ledger stay in place; process variables select this isolated demonstration. First database access bootstraps the fictional world automatically. No reset or seed command is needed. Open [127.0.0.1:43123](http://127.0.0.1:43123), then `/api/health` to verify the temporary path and five invoices. The fake gateway's remote state is process-local; keep the same server running throughout the payment demonstration.

## One story, about three minutes

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | On Import, upload `fixtures/dbs/demo.csv` | Six new credits |
| 2 | Upload the identical file again | Zero new, six already imported |
| 3 | On Review, inspect bank line 17 (`ABC CAT 104`, S$461.60) | R3 suggestion against S$500.00 INV-104; S$38.40 shortfall and reason |
| 4 | Approve that suggestion | INV-104 becomes partially paid; customer CUS-ABC has a proposed hold for DLV-201 |
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

DLV-201 is ABC's S$220.00 delivery on 18 November 2026. Initial policy is S$30.00 with no minimum age. The remaining CSV lines demonstrate alias, unique split, ambiguous amount-only, exact-reference and unmatched cases. Numbers and rules come from fixtures and code, not a presentation-only scenario.

## Optional Settings scene

On the disposable database, stop the server and use `npm run dev:policy-demo` to enable the local editor. Show explicit save/confirmation, discard, a stale-client conflict and Audit; restore demo defaults before repeating the story. Policy saves change future evaluations and do not themselves approve or release a hold. [Settings](features.md#settings) owns the validation/access details. Never proxy or tunnel this unauthenticated mode.

## Sandbox version and cleanup

Real sandbox setup is in [integrations](integrations.md#hitpay-sandbox-mcp). Use a dedicated ledger and sandbox credentials with `TALLY_GATEWAY=mcp`; fake checkout/synthetic notices do not prove a real payment. A private workstation can poll status without `PUBLIC_URL`. Public webhook delivery needs a separately validated reachable deployment compatible with the request restrictions. Confirm completed status and audit before claiming success. Do not expose the local Settings editor for callbacks.

After the demo, stop that instance. Run doctor/dump in the same terminal if needed while the temporary DB variables remain set, then close that terminal so overrides do not accidentally select the demo ledger for normal work. Keep or delete only the explicitly selected temporary database and outputs once no process uses them. No screenshot collection is required.
