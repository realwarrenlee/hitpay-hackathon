# Working on Tally

Start with [README.md](README.md), then [architecture](docs/architecture.md) and [features](docs/features.md). Each topic has one current reference. Document implemented behavior and distinguish it from unimplemented ideas. If code and the current financial reference disagree, report the discrepancy before changing financial behavior. Do not silently choose a business rule.

## Required checks

Run `npm run check` before every commit. It runs TypeScript, ESLint and all Vitest tests. Do not weaken assertions, skip tests, reduce property runs or add lint ignores to obtain a pass. See [verification](docs/verification.md) for the actual command catalog and proof limits. No commit is implied by a request to edit files.

For changed business behavior, add a meaningful regression/property check with a legal positive case. For invariant-relevant changes, demonstrate the check fails when the rule is deliberately broken, then restore the implementation. Exercise user-visible behavior with a disposable ledger; retain useful local evidence without committing secrets. HitPay changes need explicit sandbox proof before claiming provider-side behavior works. Clearly distinguish measured, inferred and unverified results.

## Financial and integration guardrails

- Money is integer SGD cents. Use `parseSgd`, `formatSgd` and `formatAmount`; no floating-point parsing/rounding of money.
- Keep `src/domain/` pure: pass date/time in; no ambient clock, randomness, environment reads or I/O. Preserve the `@/* → src/*` alias and Next.js routing conventions.
- Business changes enter the ledger command/transaction path. SQL belongs in `src/server/ledger.ts`, with schema initialization in `src/server/db.ts`; screens/actions do not write SQL. Keep error handling, projections and audit atomic. Hint-cache persistence is also owned by the ledger module.
- Bank matches require a human action, including preselected matches. The narrow automatic remainder gate and exact held-delivery settlement are defined in [features](docs/features.md#payments-and-delivery-holds); do not broaden them or bypass signatures, confirmation or deduplication.
- AI produces checked reference hints/explanations only; never amounts, money actions, approvals or hold/release decisions. AI audit attribution is confined to `hint_recorded`.
- Only humans approve pay-first holds. Policy saves do not evaluate, approve, release or rewrite existing financial history. Preserve trusted local Settings context, same-origin/socket checks and production denial. Static audit actors are not authentication.
- Audit is append-only. Corrections use explicit audited actions, never deletion or historical amount edits.
- Sandbox only: preserve `HITPAY_ENV=sandbox` enforcement and the known live MCP host refusal. Never use a live key. Call tools only through `src/server/hitpay/mcp.ts` and its allowlist; never refunds, transfers, beneficiaries or `delete_*` tools. Use installed MCP client v2, not mixed v1 SDK imports.
- Verify webhook HMAC over raw bytes with a length check and `timingSafeEqual` before parsing. Preserve remote confirmation and the shared webhook/poll receipt transaction. Do not claim the existing binding limitations are fixed without implementation and tests.

## Local files and scope

Commands run from this root. [Integrations](docs/integrations.md#environment) owns environment defaults and loading. In application source, read environment only through `src/server/env.ts`; launch/test scripts may manage their own environment.

The working ledger defaults to `data/tally.db`. Never reset/reseed it. Use a new explicit temporary path for mutating tests or browser work; the [demo guide](docs/demo.md) shows how. Opening a nonexistent database through `getDb()` can initialize fictional records. Keep runtime data distinct from `fixtures/`.

Use the fictional fixture world, never actual customer/company data. Keep keys/salts in local environment configuration, out of source, logs, captured responses, screenshots and commits. `artifacts/` and `evidence/` are local outputs; screenshots are optional. Do not delete financial records or useful evidence as an incidental cleanup.

Keep the project simple. Do not add layers, dependencies, runtime changes or deployment/authentication features as part of documentation work. Maintain Markdown links when moving documentation; update the owning topic rather than duplicating an explanation. Report changes, exact checks/output locations and anything unverified without overstating test coverage.
