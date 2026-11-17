# AGENTS.md — driving this console and its OpenBao backend

This file is for coding agents and automation. The UI is deliberately machine-friendly: stable URLs,
semantic HTML, explicit `data-testid` hooks, and no hidden state.

## Routes and deep links

| Route | Purpose | Search params |
| --- | --- | --- |
| `/login` | token/userpass sign-in, sealed-server unseal | — |
| `/secrets` | environment-aware KV browser | `project`, `env`, `service`, `folder` |
| `/search` | global key/path/project/field search, recents and favorites | `q` |
| `/runbooks` | operational notes and related-secret links | `project` |
| `/codes` | TOTP codes and admin actions | — |
| `/automation` | capability inspector and command snippets | `path` (OpenBao API path) |

Example deep link:

```
http://127.0.0.1:5173/secrets?project=ui-demo&env=staging&service=web
```

## Path conventions used by the UI

```
kv/metadata/<project>/env/                       list environments
kv/metadata/<project>/env/<env>/                 list services
kv/data/<project>/env/<env>/<path>               read/write a secret (path may contain folders)
kv/metadata/<project>/env/<env>/<path>           versions + custom_metadata (tags, comments, overrides)
kv/metadata/<project>/env/<env>/<folder>/        list a folder (recursive traversal in bao.listSecretPaths)
kv/data/<project>/creds/<name>                   shared credentials
kv/data/_runbooks/<project>                      project runbook (steps, links, secrets)
totp/keys/                                       list TOTP accounts
totp/code/<project>--<account>                   read current code
totp/keys/<project>--<account>                   account config / admin
```

The API facade is `src/lib/api.ts`. It prefixes `/v1/`, adds `X-Vault-Token` and
`X-Vault-Namespace`, and throws `BaoError` with the HTTP status. Do not add a separate proxy.

## Capability gating

All action buttons use `sys/capabilities-self` through `useCapabilities()`.
`can(map, path, capability)` returns `false` when the map is not loaded, so the UI fails closed.
When adding a new action, add its path to `capabilityPathsForFolder()`, `capabilityPathsForSecret()`,
`runbookCapabilityPaths()` or `totpCapabilityPaths()`. Secret creation is gated by the
`kv/data/<project>/env/<env>/<folder>/__new__` probe path; edits use the existing secret path and
metadata writes use the matching `kv/metadata/...` path.

Writes use `bao.writeSecret()` with a **bare** API path (`<project>/env/<env>/<service>`) — that
function adds the `kv/data/` prefix itself. Create passes CAS `0`; edit passes the current version.

## Useful test IDs

- `field-<name>` — a secret field row
- `field-table` — the spreadsheet editor; `edit-row-<name>` — a draft field row
- `edit-value-<name>` — a revealed, editable value cell
- `export-preview` — the import/export dialog's value preview
- `folder-<path>` — a folder in the secrets tree (`folder-root` for the root)
- `secret-<path>` — a secret entry in the current folder
- `compare-<env>-<key>` — a field cell in the side-by-side environment view
- `version-<n>` — a KV version row; `version-diff` — the two-version diff table
- `diff-<key>` — a field row in the version diff
- `code-<account>` / `code-value-<account>` — TOTP card and value
- `global-search-input` — global search box; `search-hit-<key-or-path>` — a result
- `command-palette` — the ⌘K/Ctrl+K overlay (also opened by the topbar Search button)
- copy buttons use `data-testid="copy-<label>"`

The dev server also exposes `GET /api/audit?path=<api path>` (localhost only, dev build only) for the
read-only "Recent activity" panel. It returns actor/operation/path/time from the local container's
audit log and never includes secret values.

## Local fixtures

`./scripts/seed.sh` creates the `ui-demo` project (dev/staging/prod × web/billing), a shared
credential, a TOTP account, and a `ui-manager` read-only login. It is idempotent and never prints
secrets.

## Rules for agents editing this repo

1. Never log or persist secret values. Keep them masked by default.
2. Do not introduce a component library or Infisical components; reuse the local primitives and
   Dough-derived tokens.
3. Keep generated snippets free of secret values — they are meant to be pasted into terminals and
   issue trackers.
4. Add a unit test in `src/lib/helpers.test.ts` for path, capability or snippet changes.
5. Run `pnpm typecheck && pnpm test && pnpm build` before declaring done.
6. This is a community prototype: do not claim upstream OpenBao endorsement in code or docs.
