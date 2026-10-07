# Architecture

Admin-only (`lexware:read` / `lexware:write`): one hub page with tabs, a dashboard widget
and a settings section.

## The four surfaces

1. **Customer/project directory** (`lx_customer`, `lx_project`). A lightweight directory
   this extension owns, so tracked time can be tied to a customer and rate before billing.
   It is not the org-wide customer directory.
2. **Time → invoice export.** Aggregates `tds-ext-time-tracker-pkg` `time_entry` rows
   linked to a project (`lx_time_link`) into a Lexware invoice (`POST /v1/invoices`, draft
   or `?finalize=true`). Effective net rate: request override → project → customer →
   global default.
3. **Contact / lead push.** Pushes a directory customer, or a lead harvested from the
   ticket systems, to Lexware as a contact (`POST /v1/contacts`), deduplicated via
   `lx_contact_map` and the stored `lexware_contact_id`.
4. **Invoice audit log** (`lx_invoice_log`). One row per export; backs the list and the
   widget count.

## Routes

| Route | Purpose |
|---|---|
| `GET /lexware/summary` | Widget |
| `GET` / `POST /lexware/customers` | Directory list / create |
| `GET` / `PATCH` / `DELETE /lexware/customers/{id:[0-9]+}` | Directory detail |
| `POST /lexware/customers/{id:[0-9]+}/projects` | Add project |
| `GET /lexware/time/unassigned`, `POST /lexware/time/assign`, `POST /lexware/time/unassign` | Link time entries |
| `GET /lexware/leads`, `POST /lexware/leads/push` | Leads from the ticket systems |
| `POST /lexware/customers/{id:[0-9]+}/push-contact` | Push a customer as contact |
| `POST /lexware/invoices/from-project` | Export time as invoice |
| `GET /lexware/invoices` | Audit log |
| `GET /lexware/admin/test` | Connection test |

## Cross-extension reads

There is **no hard `dependsOn`**. Reads of `time_entry`, `contact_message` and `ticket` go
through `Service\SourceGateway`, which checks table existence via `information_schema`
and returns `[]` when a source extension isn't composed. Lexware therefore composes on its
own. All extensions share one database and one in-process PDO.

## Data model

- Own tables are `lx_`-prefixed: `lx_customer`, `lx_project`, `lx_time_link`,
  `lx_contact_map`, `lx_invoice_log`.
- Migrations `CreateLexwareSchema`, `LexwareTimeLinkInvoiced`.
- No foreign key on `lx_time_link.time_entry_id`; another extension owns that table.
- Unsigned ids and references (MySQL 8).

## Lexware client and builders

- **`Service\LexwareClient` is plain ext-curl** (no Guzzle), the extension convention.
  Create endpoints return 201 + `id`. Errors are mapped to German messages
  (401/402/403/404/406 + `IssueList[0].i18nKey`). `isConfigured()` false → routes **503**.
- **Builders are pure and stateless** (`LexwareInvoiceBuilder`, `LexwareContactBuilder`) and
  unit-tested without the HTTP client. The invoice `address` uses `contactId` when the
  customer has a Lexware contact, else a free-text `name`.

## Settings (core `SettingsStore`, namespace `lexware`)

| Key | Secret | Env fallback |
|---|---|---|
| `api_key` | yes | `LEXWARE_API_KEY` |
| `api_url` | no | `LEXWARE_API_URL` |
| `default_hourly_rate` | no | `LEXWARE_DEFAULT_HOURLY_RATE` |
| `default_tax_rate` | no | `LEXWARE_TAX_RATE_PERCENT` |

- DB first, environment second. The settings island writes the core
  `/admin/settings/lexware`. The module resolves `SettingsStore::class` from the container
  (null in isolated tests → env fallback).
- Env reads use explicit `getenv(...) === false` checks, so the `?? … ?:` precedence trap
  can't clobber a legitimate `"0"`.
- The key comes back masked (`configured` + `last4`, never the value). **A blank key on
  save keeps the existing one.**
- A `200 {ok:false}` from `/lexware/admin/test` is **not** a working connection.

## Hub island rules (`LexwareHub`)

Two actions leave the browser and can't be undone from this UI:

- **`finalize`** turns a draft into a real Lexware invoice. It defaults to OFF, travels
  exactly as checked, and can't be clicked twice while in flight.
- **Push contact** is `disabled` for a customer that already has a `lexware_contact_id`;
  that is the only guard against a duplicate contact.
- The project picker calls `onChange(null)` on a customer switch. A stale project id would
  bill customer A's time under B.
- One toast stack, not per-panel banners: outcomes go to `toast` (tds-shared `>=0.16.0`);
  remaining banners carry validation only, as `.tds-alert--danger`.
- The widget shows `—` on failure, never `0` (which would claim nothing was ever exported).

## Motion (tds-shared ≥ 0.38.7)

The four tabs carry a `TabIndicator` and switch via `Presence`; the customer list is an
`AnimatedList`; the detail area cross-fades per customer. A leaving tab panel stays in the
DOM briefly with `aria-hidden` **and** `inert`. Tests wait for both together, not
`aria-hidden` alone, because the tab indicator carries `aria-hidden` at rest.

## Wiring

`new LexwareModule()` is registered in `tds-core-frontend-api`'s `Modules::enabled()`, and
the manifest is listed in the admin product's `frontendHost({ extensions })`.
