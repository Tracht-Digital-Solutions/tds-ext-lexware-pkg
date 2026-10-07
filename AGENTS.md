# AGENTS.md — tds-ext-lexware-pkg

Frontend extension for the **Lexware Office hub** (formerly lexoffice). An admin-only hub
page with four tabs, a dashboard widget and settings: a customer/project directory, time →
invoice export, contact/lead push and an invoice audit log. It contributes a PHP `Module`
to `tds-core-frontend-api` and the hub to the admin product.

Read `tds-frontend-contract-pkg/AGENTS.md` first. `tds-ext-support-tickets-pkg` is the
deepest reference for the container-first Module pattern. The Lexware client and invoice
logic were ported from `tds-customer-api`.

## Commands

```bash
npm install --no-package-lock   # never npm ci
npm run type-check
npm run lint:primitives
npm run test:run                # vitest
npm run build                   # tsup
composer install && composer test   # phpunit; DB integration only with TDS_TEST_DB_DSN
```

## Hard rules

- **Bind container entries unconditionally.** Never guard with `!$c->has(X::class)`.
- No hard `dependsOn`. Read other extensions' tables only through `Service\SourceGateway`.
- Own tables are `lx_`-prefixed; no cross-domain foreign keys.
- `finalize` defaults to OFF and can't be double-submitted; push-contact is disabled once a contact id exists.
- Outcomes are toasts; banners carry validation only. Never mount a `ToastHost`.
- Call the API with `apiFetch`, never a relative `fetch`.
- Every route change updates `php/docs/api.php`. Migration classes are prefixed `Lexware`.
- Stay in the `0.2.x` line (admin product pins `^0.2.x`). Versions move via the release workflow only.

## Topic files

| File | Read before |
|---|---|
| [docs/agents/architecture.md](docs/agents/architecture.md) | Changing routes, the Lexware client, builders, settings or the data model |
| [docs/agents/backend.md](docs/agents/backend.md) | Touching PHP, DI bindings, migrations or `php/docs/api.php` |
| [docs/agents/frontend-conventions.md](docs/agents/frontend-conventions.md) | Touching any island, page or widget markup |
| [docs/agents/testing.md](docs/agents/testing.md) | Writing or changing tests |
| [docs/agents/release.md](docs/agents/release.md) | Releasing or changing CI |

Workspace rules: `../CLAUDE.md`. Cross-repo state: `../MIGRATION-STATUS.md`.
