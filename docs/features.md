# Features and financial rules

This document owns implemented product behavior. References point to the implementation rather than duplicating TypeScript interfaces. Integration formats live in [integrations](integrations.md).

## Product surface

Tally is a single-business, sandbox reconciliation desk for a fictional supplier. The overview shows outstanding/overdue balances, review counts, hold states and activity. Import accepts DBS-style CSV. Review supports search/filtering, deterministic reasons, optional AI explanations, single/split approval, candidate selection, rejection, undo, batch approval of preselected matches and commit. Customer/invoice pages expose balances, reminders/payment links and delivery decisions. Settings and Audit expose policies and history; the driver page shows delivery status and checkout.

Manual allocation, confirmed-alias recording, write-off, reversal and marking an on-credit delivery released exist as domain commands. They do not all have dedicated UI forms. HitPay invoice create/list methods exist in the adapter but there is no invoice import/sync screen or `npm run seed` command. Local demo seeding does not create HitPay invoices.

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

[`flow.ts`](../src/server/flow.ts) supplies positive-remainder invoices issued within 0–60 days before the credit's value date. [`match.ts`](../src/domain/match.ts) uses known invoice tokens and human-confirmed aliases found as case-insensitive whole words in the reference/payer. A proposed AI alias alone does not establish customer identity. The first applicable branch wins:

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

References are `TALLY-{invoice-or-delivery-id}-{sequence}`. A pending remainder request for the same invoice and current amount is reused. A request first becomes `creating`, then `pending` after the gateway succeeds. Recovery for other states is limited; see [verification](verification.md#known-limitations).

Both a signed webhook confirmed against HitPay and gateway status polling enter the shared settlement path. Automatic remainder approval requires the environment flag enabled, a pending local request and equality between paid cents, request amount and the current invoice remainder. It approves and reconciles in one transaction and marks the request completed. With the flag off or mismatched state/amounts, the payment remains an unallocated credit with a human-review suggestion where there is an invoice remainder to allocate. A zero remainder can leave only the credit. Manual approval of such a suggestion does not itself mark the payment request completed.

Exact pay-first settlement releases only the matching delivery when its status and the customer's hold are both `pay_first` for that delivery. It returns the hold to normal without creating an invoice credit. Unexpected state is audited without releasing the delivery. Wrong pay-first amounts do not release it. Paying a different invoice or its remainder never clears an approved delivery hold.

Receipt deduplication is shared across webhook and polling. Processing the same applied or amount-mismatch receipt again does not reapply it. Changing the auto-approval flag does not scan existing receipts or reverse historical approvals; an old payment first processed after the change uses the effective flag then. The precise signature/remote checks and remaining binding gaps are documented in [integrations](integrations.md#webhooks-and-status-checks).

## Overdue and Cut-Off

[`overdueBalance`](../src/domain/balances.ts) and [`evaluateCutOff`](../src/domain/cutoff.ts) use the configured `TALLY_TODAY` policy date, not the browser clock or invoice due date. Invoice age is the calendar-day difference from `issuedOn`:

- Future issue dates never qualify.
- NULL/no minimum age includes today's and earlier open/partially paid invoice remainders.
- A custom positive N includes invoices strictly older than N days; age equal to N does not qualify.

The eligible overdue balance is the sum of those remaining amounts. A proposal requires that sum to be **strictly greater** than the monetary threshold, the customer's hold to be normal, and an eligible on-credit delivery scheduled on/after the policy date without a prior human credit decision. It chooses the earliest eligible delivery. Age filters the monetary total; there is no independent oldest-age OR trigger. Displays and hold evaluation use the same age-filtered balance.

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

The editor is available only through `npm run dev:policy-demo` (or explicit `TALLY_LOCAL_POLICY_EDITS=on` with the custom development launcher). It is an **unauthenticated local demonstration**, not an authenticated owner feature. Writes require development mode, trusted loopback local/peer sockets, expected Host and same-origin POST. Production, foreign origins/hosts, forwarded requests and absent trusted context are denied. An environment flag alone under plain `next dev` does not supply that context. Do not proxy/tunnel the demonstration server.

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
