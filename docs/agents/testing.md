# Testing

```bash
npm run test:run   # vitest; islands opt into jsdom per file via a @vitest-environment docblock
composer test      # phpunit
```

CI (`_build.yml`) runs both suites, plus type-check, `lint:primitives` and build, on
every run.

## Test environment against the current tds-shared

tds-shared is a **peer** dependency, so a fresh standalone install may resolve an old
version while every product build composes the current one. Keep these in mind:

- `apiFetch` first consults the host runtime config (`/tds-runtime.json`), so
  `fetch.mock.calls[0]` is that probe. Call **`primeRuntimeConfig(null)`** in
  `beforeEach`; panel products never ship that file, so "absent" matches production.
- `apiFetch` is **async**. `await waitFor(() => expect(fetch).toHaveBeenCalled())`
  before reading `mock.calls`.
- A multipart upload carries an **empty** `headers` object. Assert "no content-type
  header", never "headers is undefined".
- Error-path tests answer with a **populated** body and a non-OK status. Against an
  empty error body the ok-check is unobservable.
- At least one assertion per suite pins the **absolute API host** (see
  [frontend-conventions.md](frontend-conventions.md#api-calls-apifetch-never-a-relative-fetch)).

## Suites

| Suite | Sharpest assertions |
|---|---|
| `islands/LexwareHub.test.tsx` | `finalize` default OFF, sent exactly as checked, not double-clickable; push-contact disabled with an existing contact id; picker resets the project on customer switch |
| `islands/LexwareSettings.test.tsx` | Masked key (`configured` + `last4`); blank save keeps the key; `200 {ok:false}` is not a working connection |
| `islands/WidgetBody.test.tsx` | Three states; `—` on failure, never `0` |
| `src/index.test.ts` + `tests/packaging.test.ts` | Ids, gating, i18n parity, real `composeExtensions` collision behaviour; every specifier exported and inside `files`; version stays in the pinned minor line |
| `php/tests/LexwareInvoiceBuilderTest.php`, `LexwareContactBuilderTest.php` | Pure builder units |
| `php/tests/LexwareModuleTest.php`, `LexwareApiDocsTest.php` | Module RBAC (DB-free; auth/validation short-circuit before any repo) and API-doc parity |

Mutation check: 65 breakages, 65 caught.

### Version line

`tests/packaging.test.ts` pins the minor line the admin product caret-pins (`^0.2.x`).
Under 0.x a caret is minor-locked, so a 0.3.0 here silently stops reaching the product.
Never leave the minor line your consumers pin.
