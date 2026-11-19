# Tally

Tally helps a supplier answer: **has this been paid, and should I deliver tomorrow?** It matches DBS bank-transfer exceptions to invoices, asks a person to approve allocations, collects exact remainders through HitPay, and proposes pay-first deliveries for overdue customers. Deterministic code decides money and holds; optional AI reads payment references. This is a sandbox hackathon project.

## Quickstart

Use Node.js **22.13+** with `node:sqlite` and `--env-file-if-exists` support (previously verified on 26.2), plus npm. Run commands from this directory.

```sh
npm install
```

For a fresh checkout, copy [`.env.example`](.env.example) to `.env`; keep any existing local configuration. Then:

```sh
npm run dev
```

Open [127.0.0.1:43123](http://127.0.0.1:43123). The example selects FakeGateway, requiring no HitPay or AI key. First access to an empty database installs the fictional demo world automatically. The default ledger is `data/tally.db`; verify `TALLY_DB_URL` before running commands and never reset an existing working ledger. See [database initialization](docs/architecture.md#database-selection-and-initialization).

## Check and demonstrate

```sh
npm run check
npm run build
npm run e2e
```

`check` runs TypeScript, ESLint and all tests. `e2e` is the in-memory financial demo, not a browser test. Follow [demo instructions](docs/demo.md) for an isolated browser walkthrough and optional local Settings editing. The unauthenticated demonstration server must stay on loopback; production authentication/deployment is not implemented.

## Find your way

| Topic | Authoritative document |
| --- | --- |
| Components, persistence, routes and data flow | [Architecture](docs/architecture.md) |
| Implemented functionality and financial rules | [Features](docs/features.md) |
| HitPay, DBS, AI and environment configuration | [Integrations](docs/integrations.md) |
| Actual check commands, coverage and known limitations | [Verification](docs/verification.md) |
| Hackathon walkthrough | [Demo](docs/demo.md) |
| Coding-agent guardrails | [AGENTS.md](AGENTS.md) |

`src/app/` holds routes; `src/components/` UI; `src/domain/` pure financial rules; `src/server/` persistence and integrations. Tests and fictional inputs live in `tests/` and `fixtures/`; operations in `scripts/`. Private runtime data is under `data/`. Generated logs/dumps in `artifacts/` and optional screenshots/reports in `evidence/` are ignored by Git.
