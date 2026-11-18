# AGENTS.md — driving this console and its OpenBao backend

This file is for coding agents and automation. The UI is deliberately machine-friendly: stable URLs,
semantic HTML, explicit `data-testid` hooks, and no hidden state.

## Routes and deep links

| Route | Purpose | Search params |
| --- | --- | --- |
| `/login` | token/userpass sign-in, sealed-server unseal | — |
| `/welcome` | getting-started checklist that follows live server state | — |
| `/secrets` | environment-aware KV browser | `project`, `env`, `service`, `folder` |
| `/trash` | soft-deleted KV versions recoverable from metadata (no values shown) | `project` |
| `/search` | global key/path/project/field search, recents and favorites | `q` |
| `/runbooks` | operational notes and related-secret links | `project` |
| `/codes` | TOTP codes and admin actions | — |
| `/access` | visual access control: roles, policy builder, simulator, machine identities | `view`, `project`, `env` |
| `/audit` | full audit-log viewer with search and filters | `q`, `actor`, `operation`, `range` |
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

**ACL glob caveat:** the local OpenBao build treats a trailing `*` as a recursive prefix wildcard
(`kv/data/ui-demo/env/*` covers every environment and folder). Mid-path `*`, `**` and `?` are
literal characters. Generate and seed policies with the `*` at the end of the path; `globMatches()`
in `src/lib/policy.ts` mirrors this. Confirm with `sys/capabilities` if in doubt.

## Capability gating

All action buttons use `sys/capabilities-self` through `useCapabilities()`.
`can(map, path, capability)` returns `false` when the map is not loaded, so the UI fails closed.
When adding a new action, add its path to `capabilityPathsForFolder()`, `capabilityPathsForSecret()`,
`runbookCapabilityPaths()` or `totpCapabilityPaths()`. Secret creation is gated by the
`kv/data/<project>/env/<env>/<folder>/__new__` probe path; edits use the existing secret path and
metadata writes use the matching `kv/metadata/...` path.

Writes use `bao.writeSecret()` with a **bare** API path (`<project>/env/<env>/<service>`) — that
function adds the `kv/data/` prefix itself. Create passes CAS `0`; edit passes the current version.

**Version lifecycle:** `kv/data/<path>` soft-deletes the latest version; `kv/delete/<path>`,
`kv/undelete/<path>` and `kv/destroy/<path>` operate on specific versions; `kv/metadata/<path>`
DELETE purges the key and all versions. Per-secret version settings live on `kv/metadata/<path>`.
OpenBao's JSON merge-patch ignores zero values (`delete_version_after: "0s"`, `max_versions: 0`),
so `patchMetadataSettings()` reads the current metadata and issues a full POST that preserves
`custom_metadata` and every omitted setting. With `cas_required`, inline edits pass a freshly read
CAS version; without it they PATCH so concurrent edits to other fields cannot conflict.

**Trash** reads KV metadata only (`deletion_time`, `destroyed`); it never reads version data, so it
cannot surface a secret value. Lifecycle capability paths are added in `lifecycleCapabilityPaths()`
and wired into `capabilityPathsForSecret()` / `capabilityPathsForFolder()`.

## Useful test IDs

- `field-<name>` — a secret field row
- `field-table` — the spreadsheet editor; `edit-row-<name>` — a draft field row
- `edit-value-<name>` — a revealed, editable value cell
- `export-preview` — the import/export dialog's value preview
- `folder-<path>` — a folder in the secrets tree (`folder-root` for the root)
- `secret-<path>` — a secret entry in the current folder
- `compare-<env>-<key>` — a field cell in the side-by-side environment view
- `version-<n>` — a KV version row; `version-diff` — the two-version diff table
- `delete-version-<n>` / `undelete-<n>` / `destroy-<n>` — per-version lifecycle actions
- `version-history` / `open-trash` / `purge-secret` / `lifecycle-confirm` / `confirm-lifecycle` — history and lifecycle UI
- `secret-settings` / `save-version-settings` — per-secret `max_versions`, `delete_version_after`, `cas_required`
- `trash-project` / `trash-table` / `trash-<path>-<n>` / `trash-restore-<n>` / `trash-destroy-<n>` / `trash-confirm-action` — Trash view
- `diff-<key>` — a field row in the version diff
- `code-<account>` / `code-value-<account>` — TOTP card and value
- `global-search-input` — global search box; `search-hit-<key-or-path>` — a result
- `command-palette` — the ⌘K/Ctrl+K overlay (also opened by the topbar Search button)
- `access-tab-<view>` — access-control tab (`roles`, `builder`, `simulator`, `identities`)
- `role-template-<id>` / `write-<id>` — a role card and its policy-write button
- `policy-rules` / `policy-rule-<n>` / `save-policy` — visual policy builder
- `simulator-run` / `simulator-result-<path>` — capability simulator and its result rows
- `identity-kind-<kind>` / `identity-snippet-cli` / `identity-snippet-http` — machine-identity wizard
- `audit-search` / `audit-actor` / `audit-operation` / `audit-range` — audit filters; `audit-table` / `audit-entry-<n>` — results
- `welcome-page` — getting-started guide (`data-stage` = derived server stage); `welcome-step-<id>` — checklist steps
- `onboarding-banner` / `onboarding-open` / `onboarding-dismiss` — first-run hint on `/secrets`
- `shortcuts-open` / `shortcuts-dialog` / `shortcut-list` — keyboard-shortcut help
- copy buttons use `data-testid="copy-<label>"`

The dev server also exposes `GET /api/audit?path=<api path>&limit=<n>` (localhost only, dev build
only) for the "Recent activity" panel and the full `/audit` viewer. It returns
actor/operation/path/time/result from the local container's audit log, capped at 2000 entries, and
never includes secret values.

## Local fixtures

`./scripts/seed.sh` creates the `ui-demo` project (dev/staging/prod × web/billing), a shared
credential, a TOTP account, a `ui-manager` read-only login, the `ui-demo-viewer/developer/admin`
role policies, and a `ui-demo-ci` identity entity. It is idempotent and never prints secrets.

The access simulator mints a short-lived token with `auth/token/create`, checks `sys/capabilities`
and revokes the token in a `finally` block; the token value never reaches UI state or logs. When the
current token cannot mint one, it falls back to describing the selected policies locally.

**Onboarding and shortcuts:** `/welcome` derives its stage from `sys/health`, `sys/seal-status`,
`sys/mounts/kv` and the project list (`deriveSetupStage()` in `src/lib/setup.ts`). The operator
commands it shows never contain secret values — `operator init` output is never displayed or stored.
The first-run banner is remembered in `localStorage` under `console.onboarding`; `resetOnboarding()`
restores it. Global shortcuts are `⌘K/Ctrl+K` (palette), `Alt+1`–`Alt+8` (sidebar sections), `/`
(search), `?` (shortcut help) and `Esc`; they pause while typing in a field. A skip link and a
`prefers-reduced-motion` rule are in the app shell and global CSS.

## Rules for agents editing this repo

1. Never log or persist secret values. Keep them masked by default.
2. Do not introduce a component library or Infisical components; reuse the local primitives and
   Dough-derived tokens.
3. Keep generated snippets free of secret values — they are meant to be pasted into terminals and
   issue trackers.
4. Add a unit test in `src/lib/helpers.test.ts` for path, capability or snippet changes.
5. Run `pnpm typecheck && pnpm test && pnpm build` before declaring done.
6. This is a community prototype: do not claim upstream OpenBao endorsement in code or docs.
