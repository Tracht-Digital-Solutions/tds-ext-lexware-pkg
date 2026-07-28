# AGENTS.md — tds-ext-lexware-pkg

The **Lexware billing hub** frontend extension: connects the frontend's data to
Lexware Office (formerly lexoffice). Read `tds-frontend-contract-pkg`'s AGENTS.md first
(extensions implement that contract); `tds-ext-support-tickets-pkg` is the deepest
reference for the container-first Module pattern, and this extension ports the
Lexware client/invoice logic originally in `tds-customer-api`.

## What it does

An **admin-only** extension (`lexware:read` / `lexware:write`) with four surfaces
(one hub page, tabs) + a dashboard widget + a settings frontend:

1. **Customer/project directory** (`lx_customer`, `lx_project`) — a lightweight
   directory the extension owns so tracked time can be tied to a customer + rate
   before billing. NOT the (future) org-wide customer directory.
2. **Time → invoice export** — aggregates `tds-ext-time-tracker-pkg` `time_entry`
   rows that are linked to a project (`lx_time_link`) into a Lexware invoice
   (`POST /v1/invoices`, draft or `?finalize=true`). Effective net rate:
   request override → project → customer → global default.
3. **Contact / lead push** — pushes a directory customer, or a lead harvested
   from the ticket systems, to Lexware as a contact (`POST /v1/contacts`), with a
   dedupe map (`lx_contact_map`) + the stored `lexware_contact_id`.
4. **Invoice audit log** (`lx_invoice_log`) — one row per export; backs the list
   + the widget count.

## Architecture notes (don't regress)

- **No hard `dependsOn`.** Cross-extension reads (`time_entry`, `contact_message`,
  `ticket`) go through `Service\SourceGateway`, which checks table existence via
  `information_schema` and returns `[]` when a source extension isn't composed —
  so Lexware composes on its own. Shared DB, one in-process PDO.
- **Own tables are `lx_`-prefixed**; the single migration class is `Lexware*`-
  prefixed (in-process auto-migrator = one process = no class-name reuse). No
  cross-domain FK on `lx_time_link.time_entry_id` (another extension owns that
  table — same rule as `ticket.customer_id`). MySQL-8-safe: `signed => false` on
  every id/FK column.
- **Config via the core `SettingsStore` (contract interface), ns=`lexware`** —
  `api_key` (secret), `api_url`, `default_hourly_rate`, `default_tax_rate`, read
  DB-first with an env fallback (`LEXWARE_API_KEY` / `LEXWARE_API_URL` /
  `LEXWARE_DEFAULT_HOURLY_RATE` / `LEXWARE_TAX_RATE_PERCENT`). The settings island
  writes the core `/admin/settings/lexware`; the module resolves
  `SettingsStore::class` from the container (null in isolated tests → env
  fallback). Reads use explicit `getenv(...) === false` checks (the `?? … ?:`
  precedence trap must not clobber a legit `"0"`).
- **`LexwareClient` is plain ext-curl** (no Guzzle) — the extension convention.
  Create endpoints return 201+`id`; German error mapping (401/402/403/404/406 +
  `IssueList[0].i18nKey`). `isConfigured()` false (no key) → routes 503.
- **Builders are pure/stateless** (`LexwareInvoiceBuilder`, `LexwareContactBuilder`)
  → unit-tested without the HTTP client. Invoice `address` uses `contactId` when
  the customer has a Lexware contact, else a free-text `name`.

## Conventions baked in (from the template)

- Depends on the **published** `tds-frontend-contract` `^1.0.0` — Composer via the
  public **VCS** repo (no path repo — CI fatals on a missing path repo), npm from
  GitHub Packages (`.npmrc` + `NPM_TOKEN` set from `PACKAGE_TOKEN`).
- CI installs with **`npm install --no-package-lock`** (win32 lockfile breaks the
  Linux runner). Prune steps are `continue-on-error` (needs `delete:packages`).
- Release bumps `package.json` + `composer.json` in lockstep; the pushed
  **annotated** tag is the Composer release ref.

## Tests

```bash
npm run test:run    # vitest, 150 tests (jsdom per-file via a @vitest-environment docblock)
```

- `islands/LexwareHub.test.tsx` — the four tabs. Two things here reach out of the
  browser and cannot be undone from this UI, so they carry the sharpest
  assertions: **`finalize`** (it turns a draft into a real Lexware invoice —
  pinned to default OFF, to travel exactly as checked, and to be unclickable
  twice while in flight) and **push-contact** (the `disabled` state on a
  customer that already has a `lexware_contact_id` is the only guard against a
  duplicate contact). The picker's `onChange(null)` on a customer switch is
  pinned too — a stale project id would bill customer A's time under B.
- `islands/LexwareSettings.test.tsx` — the settings-store secret contract: the
  key comes back masked (`configured` + `last4`, never the value) and **a blank
  key on save means "keep the existing one"**. Also that a `200 {ok:false}` from
  `/lexware/admin/test` is NOT reported as a working connection.
- `islands/WidgetBody.test.tsx` — the widget's three states. `—` on a failure,
  never `0`: the latter claims nothing was ever exported.
- `src/index.test.ts` + `tests/packaging.test.ts` — the manifest as a product
  build sees it (ids, gating, i18n parity, real `composeExtensions` collision
  behaviour) and that every specifier resolves to a file that is both exported
  and inside the published `files` allow-list.

Error-path tests deliberately answer with a POPULATED body and a non-OK status.
Against an EMPTY error body `res.ok ? (await res.json()).x ?? [] : []` and a bare
`await res.json()` are indistinguishable, so the ok-check could be deleted with
no test noticing.

`tests/packaging.test.ts` pins the version to the **0.1** line, because
`tds-admin-frontend` caret-pins `^0.1.1` and under 0.x a caret means
`>=0.1.1 <0.2.0` — a 0.2.0 here silently stops reaching the product. (The root
`CLAUDE.md` says all extensions stay in `0.1.x`; that is not universal —
support-tickets is 0.7.x and contact-tickets 0.2.x. The real rule is: never
leave the minor line your consumers pin.)

Verified by mutation: 65 deliberate breakages introduced, 65 caught.

## Commands

```bash
composer install && composer test    # phpunit: Module RBAC + builder units
npm install --no-package-lock && npm run type-check && npm run test:run && npm run build
```

DB-backed integration runs against real MariaDB/MySQL only when `TDS_TEST_DB_DSN`
is set (the unit suite is DB-free — auth/validation short-circuits before any
repo). Register `new LexwareModule()` in `tds-core-frontend-api`'s `Modules::enabled()`
and add the manifest to the admin target's `frontendHost({ extensions })`.
