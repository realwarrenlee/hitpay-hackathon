# Features and financial rules

This document owns implemented product behavior. References point to the implementation rather than duplicating TypeScript interfaces. Integration formats live in [integrations](integrations.md).

## Product surface

Tally is a single-business, sandbox supplier workflow using fictional demonstration data. `/deliveries` shows all deliveries on/after the explicit policy date without date filters, with customer, amount, invoice balances, decision state, uncertain payment evidence and next action. `/deliveries/[id]` shows invoice due dates, the applied/current policy, relevant unallocated credits, last recorded import, checkout/status, reasoned exceptions and delivery-specific Audit. Overview links to upcoming decisions. New invoice/delivery forms are available from Deliveries and customer views.

The overview shows outstanding/overdue balances, review counts, hold states and activity. Import accepts DBS-style CSV. Review supports search across all credit statuses, deterministic reasons, optional AI explanations, single/split approval, radio invoice choice for ambiguous matches, rejection, undo and per-credit reconciliation of existing approvals. There are no browser batch controls. Customer/invoice pages expose balances, reminders/payment links and delivery decisions. Settings and Audit expose policies and history; the driver page shows delivery status and checkout.

Manual allocation, confirmed-alias recording, write-off, reversal and marking an on-credit delivery released exist as domain commands. They do not all have dedicated UI forms. HitPay invoice create/list methods exist in the adapter but there is no invoice import/sync screen or `npm run seed` command. Local demo seeding does not create HitPay invoices.

## Supplier entry and access

`/invoice/new` records an existing customer, unique invoice reference, positive exact SGD amount, valid issue date and mandatory agreed due date. Due date cannot precede issue date. Existing legacy NULL dates remain supported and excluded from automatic overdue proposals. `/deliveries/new` records an existing customer, unique delivery reference, positive exact amount and valid scheduled date. Valid historical dates may be entered; only dates on/after policy date appear in the upcoming queue. No creation form resets or reseeds a ledger.

Invoice references use `INV-` plus 3–6 digits; delivery references use `DLV-` plus 3–9 digits. Same reference and identical immutable facts returns the existing record without extra audit or duplicates; different facts reject. Entries and human attribution persist transactionally and across process restart. New invoices affect balances/matching and future evaluations. Creation and evaluation are distinct: creation never automatically approves a hold, collects payment or releases a delivery.

Supplier mutations require the explicitly enabled, unauthenticated local loopback environment: `TALLY_LOCAL_LEDGER_EDITS=on` with `npm run dev`, or `npm run dev:supplier-demo`. Server checks require development mode, trusted local/peer loopback sockets, expected Host and same-origin POST; missing context, foreign origin/host, forwarded/network requests and production are denied before ledger/gateway access. Without the opt-in, supplier mutation controls stay locked. The same guard covers existing reconciliation/customer actions, fake checkout and payment-poll/hints POST APIs. Signed HitPay webhooks use their separate integration verification path. [Settings](#settings) requires this same opt-in plus an explicit disposable-ledger declaration and sandbox configuration; the marker alone enables neither supplier actions nor real sandbox payments. Audit uses `Local development operator`, not an authenticated owner claim.

On-credit is a state, not proof of payment or safety. The existing policy evaluates the earliest eligible delivery per customer; later deliveries link to that decision first. The detail action passes the expected delivery ID into the ledger transaction. Pay-first proposals require explicit human approval; rejection/override requires an entered reason and records a human exception. Paying the delivery amount releases that held delivery only, leaving prior invoices outstanding. Failed checkout creation stays visible and blocked; operator-assisted recovery remains a limitation.

Possible customer bank credits are linked by recorded suggestions/invoice IDs/confirmed aliases and explicitly labelled uncertain. Unidentified credits may still be relevant; the screen links to all Review evidence. Unreviewed credits never reduce invoice balances. Human-approved allocations already affect balances even before commit, as described below. Last import is shown only when CSV audit timestamps exist.

### Review and activity presentation

Bank credits (`/review`) keeps dates, payer/reference, credit amounts, suggested invoices and status in the primary list, with an Import bank file action. The sidebar has six destinations grouped into Workspace (Overview, Deliveries, Bank credits, Customers) and Management (Activity, Settings); `/import` remains a workflow within Bank credits. A review drawer contains one structured evidence section with payer evidence, invoice choices, proposed allocation, remaining balance and matching uncertainty. Repeated generated explanations and technical record dropdowns are not displayed; the original evidence remains stored. Partial-payment wording does not infer why a customer paid less. Credit status tabs are omitted; search and status badges are retained. There is no bulk-action panel, mode switch, selection total or row checkbox. Ambiguous matches retain radio invoice choice, initially unselected. Individual Review keeps approve/reject/undo and shows Reconcile whenever that credit has approved allocation IDs, subject to the existing access guards. Reconcile confirms the credit and approved amount being reconciled, then sends only that credit's existing approved allocation IDs through unchanged `commitAction`/`commit_approved`. It finalizes those allocations and removes Undo without changing invoice or credit balances again; other credits and original bank/invoice records are untouched. Missing/duplicate/invalid/stale targets reject atomically through the existing command path. Server/domain bulk commands remain, including the original all-eligible operation for internal callers that omit target lists, but there are no browser batch controls.

Activity separates actor, date and time, uses Singapore time, and sorts newest first by instant with numeric audit-ID ordering for timestamp ties. Supplemental ordering/timezone labels and result counts are omitted, as are the global policy-date label and repeated list-header reminders; record dates and decision evidence remain visible. Search changes only the displayed events; there are no category tabs or technical record expanders. Related identifiers, meaningful human reasons and readable policy changes remain visible. Raw timestamps, actor structures, before/after objects and original evidence remain in the append-only ledger and the separate `ledger:dump` operator export, not an owner-facing JSON drawer. Mobile/tablet views use stacked records and cards. Deliveries shows bank evidence, delivery payment and delivery decisions separately from invoice debt; on credit does not mean paid. Invoice collection stays visible and lists only positive remaining balances; paid history remains under customer invoices.

Overview counts credits with unallocated money (excluding payouts) and actual upcoming delivery proposals, approved pay-first obligations and evaluations not already recorded for the current policy/date/overdue amount. It does not manufacture tasks for completed evaluations. Unallocated verified receipts remain visible in Review even without an invoice suggestion.

## Money and approval

[`money.ts`](../src/domain/money.ts) represents SGD as nonnegative safe integer cents. Parse and format with `parseSgd`, `formatSgd` and `formatAmount`; do not use floating-point parsing/rounding for business amounts.

- Credit conservation: `credit amount = approved/reconciled allocations + unallocated`.
- Invoice conservation: `invoice total = approved/reconciled allocations + write-offs + remaining`.
- Neither a credit's used amount nor an invoice's allocated/write-off amount may exceed its available balance. Existing suggestions are checked against live balances again at approval.
- Suggested allocations do not change invoice balances. Approval changes the balance immediately; committing approved allocations locks them as reconciled without applying the money twice.
- A bank CSV match always requires a human approval action. An R1 preselection is not automatic approval.
- Overpayment remains unallocated credit, flagged for review. A short payment never silently becomes a write-off. Reversals and write-offs require a human actor and a nonempty reason.

The [allocation edge table](../src/domain/transitions.ts) permits `suggested → approved → reconciled → reversed`, `suggested → rejected`, and `approved → suggested` through undo. Reject/reverse are terminal for that allocation. Split approval applies the whole group atomically; choosing one candidate approves it and rejects its siblings. Manual allocation creates a suggestion and approval in one transaction.

## Matching

[`flow.ts`](../src/server/flow.ts) supplies invoice facts to the matcher. Ordinary candidates keep the 0–60-day issue-date window. A literal whole-word invoice ID in the bank reference admits an older unpaid invoice, including a 120-day payment, only when exactly one literal invoice is referenced and no multiple/conflicting confirmed customer identities appear. Model-only tokens and amount-only evidence cannot extend the window. Paid or future-issued references stay unmatched without unrelated fallback. [`match.ts`](../src/domain/match.ts) uses known invoice tokens and human-confirmed aliases found as case-insensitive whole words in the reference/payer. A proposed AI alias alone does not establish customer identity. The first applicable branch wins:

| Priority | Input/condition | Result |
| --- | --- | --- |
| 1 | One invoice token; exact amount | R1, tier A, single, preselected |
| 2 | One token; amount below remaining | R3, tier B, partial suggestion with exact shortfall |
| 3 | One token; amount above remaining | R6, tier B, capped allocation and unallocated excess |
| 4 | Multiple tokens, same customer, exactly one exact subset | R4, tier B, split |
| 5 | Multiple tokens without that unique subset | R5, tier C, choose one |
| 6 | No tokens; confirmed customer; exactly one exact-amount invoice | R2, tier B, single |
| 7 | Confirmed customer; 2–4 open invoices; exactly one exact subset | R4, tier B, split |
| 8 | Confirmed customer; only one invoice; credit exceeds remainder | R6, tier C, capped allocation |
| 9 | Confirmed customer; otherwise has candidates with remaining ≤ credit | R5, tier C, choose one |
| 10 | No customer; one or more exact-amount invoices | R5, tier C, choose one, even for one candidate |
| 11 | No applicable candidate | Unmatched, with a deterministic reason |

Subset enumeration considers groups of at least two and at most four invoices. Only R1 bank suggestions are preselected. Other tiers require explicit selection/approval; amount alone never preselects. The matcher suggests a shortfall, not its cause. Optional [AI hints](integrations.md#ai-reference-hints) assist reference reading and explanation, never allocation amounts, approvals or holds.

## Payments and delivery holds

Two separate purposes exist:

| Purpose | Amount | Settlement effect |
| --- | --- | --- |
| Invoice remainder | Current invoice remainder, minimum S$0.30 | May create/approve/reconcile an invoice credit under the gate below |
| Pay-first delivery | Delivery total, minimum S$0.30 | Exact payment may release that held delivery; creates no bank credit and does not settle old invoices |

References are `TALLY-{invoice-or-delivery-id}-{sequence}`. A pending remainder request for the same invoice and current amount is reused. A request first becomes `creating`, then `pending` after the gateway succeeds. An unresolved `creating` request blocks another creation for that obligation. Invoice/customer pages show its reference and instruct the operator to inspect provider state. A timeout does not prove no remote request exists. Automatic recreation or attaching an unverified remote request is not implemented; see [verification](verification.md#known-limitations).

Both a signed webhook confirmed against HitPay and gateway status polling enter the shared settlement path after binding local/remote request IDs, reference, SGD currency, purpose, amount and remote completed status. Signed amounts must equal remote amounts; supplied event currency, purpose, status and type must agree. Verification mismatches record rejection evidence without credits, allocations or release and allow later valid confirmation. The transaction rechecks stored ID, pending status, amount and obligation linkage. Automatic remainder approval requires the environment flag enabled, a pending local request and equality between paid cents, request amount and the current invoice remainder. It approves and reconciles in one transaction and marks the request completed. With the flag off or a changed current invoice remainder, an otherwise correctly bound payment remains an unallocated credit with a human-review suggestion where there is an invoice remainder to allocate. A zero remainder can leave only the credit. Remote/event/local-request verification mismatches instead reject before creating any credit. Manual approval of such a suggestion does not itself mark the payment request completed.

Exact pay-first settlement releases only the matching delivery when its status and the customer's hold are both `pay_first` for that delivery. It returns the hold to normal without creating an invoice credit. Unexpected state is audited without releasing the delivery. Wrong pay-first amounts do not release it. Paying a different invoice or its remainder never clears an approved delivery hold.

Receipt deduplication is shared across webhook and polling. Applied settlements and receipts that created review credits deduplicate across both sources. Identical rejection evidence deduplicates, while a corrected confirmation can settle later. Legacy amount-mismatch receipts that already created credits remain consumed. Changing the auto-approval flag does not scan existing receipts or reverse historical approvals; an old payment first processed after the change uses the effective flag then. The precise signature/remote checks and provider proof limits are documented in [integrations](integrations.md#webhooks-and-status-checks).

## Overdue and Cut-Off

[`overdueBalance`](../src/domain/balances.ts) and [`evaluateCutOff`](../src/domain/cutoff.ts) use the configured `TALLY_TODAY` Singapore policy date and explicit invoice `dueOn`, with pure calendar arithmetic:

- An invoice is within terms before and on its due date, becoming overdue the next calendar day.
- NULL/no grace period means days past due must be strictly greater than zero.
- Positive N grace days means days past due must be strictly greater than N; equality does not qualify.
- Unknown due dates are labelled on invoice/customer pages and excluded from automatic overdue proposals; their balances remain outstanding.
- Only open/partially paid remaining balances count. Dashboard, customer displays and hold evaluation share this calculation.

The additive `invoice.due_on` migration leaves existing dates NULL. It does not invent historical payment terms or change money, holds or audit. The existing numeric `overdue_days_threshold` is retained as grace days after due date, rather than issue age; Settings explains the changed meaning. Existing proposals/approved holds remain unchanged. New disposable bootstrap records have explicit due dates. Historical policy audit entries retain their issue-age wording; new saves identify the due-date basis.

The eligible overdue balance is the sum of those remaining amounts. A proposal requires that sum to be **strictly greater** than the monetary threshold, the customer's hold to be normal, and an eligible on-credit delivery scheduled on/after the policy date without a prior human credit decision. It chooses the earliest eligible delivery. Due-date/grace eligibility filters the monetary total; there is no independent age-only trigger. Displays and hold evaluation use the same eligible balance.

Cut-Off runs after balance-changing commands and on **Check Cut-Off**, not on a page render, timer or policy save. It proposes only. The workflow is:

| Action | Customer hold | Delivery |
| --- | --- | --- |
| Threshold evaluation | `normal → proposed` | `on_credit → proposed_pay_first` |
| Human approves | `proposed → pay_first` | `proposed_pay_first → pay_first`; creates delivery payment request |
| Human rejects proposal | `proposed → normal` | Back to `on_credit`, records the human credit decision |
| Human overrides hold | `pay_first → normal` | Back to `on_credit`, records the human credit decision |
| Exact confirmed payment for the held delivery | `pay_first → normal` | `pay_first → released` |

A rejected/overridden delivery is not proposed again. Override does not directly mark it released; a human domain command can subsequently mark an on-credit delivery released. Existing proposals are not automatically rechecked when a human approves them.

## Settings

`/settings` shows the numeric policy and the actual environment-controlled auto-approval state. Numeric settings are singleton SQLite values shared by the whole ledger; there is no tenant-specific or per-user policy.

The editor works through normal `npm run dev` when [`readLocalPolicyMode`](../src/server/env.ts) permits this **unauthenticated local demonstration**, not an authenticated owner feature. It requires:

- [`readLocalLedgerMode`](../src/server/env.ts): `NODE_ENV=development` and `TALLY_LOCAL_LEDGER_EDITS` exactly `on` (no surrounding whitespace). The supplier opt-in is required for Settings too.
- Explicit `HITPAY_ENV=sandbox` and explicit `TALLY_GATEWAY=fake` or `mcp`, both checked after trimming. Unset values or inferred gateway defaults do not qualify. The known-live `mcp.hit-pay.com` hostname remains refused.
- Explicit `TALLY_DB_URL` and `TALLY_DEMO_DB_URL` pointing to the same path after `file:` prefix/path normalization, or both `:memory:`. The default `data/tally.db` cannot be designated, even explicitly.

`TALLY_DEMO_DB_URL` is the operator's declaration that the selected ledger is disposable, not an inspection of its contents or a filename heuristic. Sandbox HitPay credentials and a configured `PUBLIC_URL` do not deny Settings; `PUBLIC_URL` does not grant network access. `TALLY_LOCAL_POLICY_EDITS` is obsolete; `npm run dev:policy-demo` is an ordinary `npm run dev` compatibility alias, not an opt-in or bypass. The [fake preparation](demo.md#prepare-a-browser-demonstration) and [real sandbox workflow](demo.md#real-hitpay-sandbox-workflow) supply the setup without changing `.env` or the working ledger.

Request guards are unchanged: writes require trusted loopback local/peer sockets, expected Host and same-origin POST. Production, foreign origins/hosts, forwarded requests and absent trusted context are denied. Plain `next dev` does not supply the trusted context. Do not proxy/tunnel the demonstration server. The shared [supplier opt-in](#supplier-entry-and-access) does not replace Settings' additional disposable-ledger checks.

The [policy parser](../src/domain/policy.ts), [service](../src/server/policy.ts) and [Settings actions](../src/app/settings/actions.ts) implement:

- Exact nonnegative SGD up to the safe integer-cent limit, at most two decimal places; zero is valid.
- Explicit NULL/no age minimum or a positive whole day count bounded by the supported four-digit date span. Zero/negative/fractional days and extra input fields are rejected. Legacy zero values are not silently migrated.
- Explicit save, discard, confirmation, pending/success/error states and reload after conflicts. No autosave. Failed/unconfirmed requests retain edits for recovery.
- Optimistic concurrency: `expectedVersion` must equal the persisted `policy_version` within the ledger transaction. A real change increments the version and writes one `policy_updated` audit; a no-op changes neither. Storage failure rolls everything back.
- The server supplies actor `Local development operator` with `loopback_development` access, rather than accepting an actor from the form.

Saving changes policy/configuration only. It does not evaluate deliveries, approve/release holds, rescan payments or rewrite previous financial history. Existing proposed/approved holds remain. Subsequent evaluations use the current policy, and proposal audit payloads include its version. `TALLY_AUTO_APPROVE_REMAINDER` is read-only here; a numeric save cannot change it.

## Audit and invariant vocabulary

Audit records carry actor, time, entity/action, before/after values and evidence such as CSV batch/line, settlement receipt/source, threshold or human reason. The audit table is append-only; business state and its audit are persisted together. AI attribution is confined to `hint_recorded`; a regex-only reference read may also use that audit label, so it is not proof a model was called. Generic `Owner` and local operator names are attribution, not verified identity.

These IDs name the rule families used by tests and doctor; the [verification guide](verification.md#coverage-and-its-limits) describes the actual scope of their checkers.

| ID | Rule family |
| --- | --- |
| I1 | AI cannot originate money or financial actions |
| I2 | Per-credit conservation and no double allocation |
| I3 | Per-invoice conservation and nonnegative remaining balance |
| I4 | Human, reasoned write-offs |
| I5 | Legal allocation state transitions |
| I6 | Audit coverage for recorded business objects/changes |
| I7 | Unique import/settlement credit keys without collapsing identical-looking rows |
| I8 | Human approval required to enter pay-first |
| I9–I10 | Narrow held-delivery release and consistent payment/hold state |
| C1 | Stored balances equal recomputed projections |
| C2 | Customer holds and delivery states agree |
| C3 | Each completed request has exactly one applied receipt |

## Unimplemented scope

Stripe CPM/Payment Records, OCBC/UOB/POSB adapters, invoice synchronization/seeding through MCP as an application workflow, WhatsApp promise extraction, grouped multi-credit suggestions, accounting export/sync, credit scoring/public-signal scraping, tenant isolation and production authentication/deployment remain ideas or absent features. `TALLY_STRIPE` and Stripe-related fields do not provide a working Stripe integration. Archived schedules are not delivery commitments.
