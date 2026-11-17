# OpenBao Console (community prototype)

A small, opinionated OpenBao UI built for the first iteration we agreed on:
**environment-aware KV browsing, one-time codes, and an automation view that machines can use.**

This is **not** an upstream OpenBao project and not a Dough fork. It is a fresh Vite + React app that
reuses Dough's design tokens (and a few clean primitives) for visual continuity. It talks to the
standard OpenBao HTTP API, so every action a human takes here has an equivalent CLI/cURL command.

## Why a fresh Vite app instead of the Adfinis Dough fork?

| Criterion | Adfinis fork | Fresh Vite (this repo) |
| --- | --- | --- |
| Build tooling | Rsbuild + generated 500 KB API client | Vite, tiny typed API facade |
| Route coverage | Mostly stubs / 404s | A small set of working, deep-linkable surfaces |
| Architecture | No spec, many aspirational routes | One layout, focused features, explicit paths |
| Onboarding for new contributors | Must learn generated client + aliases | Standard Vite/React/TS |
| Look and feel | Good tokens/components | Reused tokens + primitives |

The fork remains useful as a design reference; it is a poor base for a small, reviewable first slice.

## What is in this slice

- **Sign in:** token or userpass against any OpenBao address/namespace; sealed-server unseal flow.
  OIDC is visibly deferred rather than faked.
- **Secrets:** project → environment → **folder** → secret browsing, with a folder tree,
  breadcrumbs and deep links. Folders are path segments under `kv/data/<project>/env/<env>/`; the
  original flat secrets (`web`, `billing`) remain at the root. Masked-by-default field reveal/copy,
  shared credentials, version history, safe `.env` copy, and promotion with a destination preview.
- **Environments side by side:** a compare panel shows the same secret path across dev/staging/prod
  in columns, with masked values, version stamps, "differs" markers, an only-differences filter and
  clear "absent in this environment" markers.
- **Version history and rollback:** pick any KV v2 version for a point-in-time view, choose two
  versions for a masked field-by-field diff (added/removed/changed), see the actor from the local
  audit log when available, and restore an older version as a new CAS-protected write.
- **Real secrets editor:** spreadsheet-style field table with inline edit, per-field reveal, copy,
  multi-line values and one-click row removal. Bulk paste, `.env`/JSON/YAML/TSV import (file or
  paste), matching export, and “from another environment” value staging are all available in the
  draft before a single write happens. Tags, a secret note, per-field comments and **personal
  overrides** live in KV v2 custom metadata. `${folder.KEY}` references are previewed against the
  current environment without being rewritten. Creates use CAS `0`, edits use the current version
  as CAS, and both are capability gated and recorded in the audit log.
- **Runbooks:** operational notes from `_runbooks/<project>`, with numbered steps, owner/rotation,
  external links and one-click deep links back to the related secrets. Tolerates the original
  single-`steps`-string fixture as well as the richer structured shape.
- **One-time codes (TOTP):** live codes with countdown, copy, admin create/delete; the seed is
  generated inside OpenBao and never displayed. If your token may read individual codes but cannot
  list every account (typical for managers), the page offers an **“Open a code by name”** panel:
  type the exact account name (for example `ui-demo--example-console`) to load just that code.
  Pinned names live in this browser tab only; codes are never stored.
- **For agents:** identity and policy summary, capability inspection for any path, and copyable
  CLI/cURL/`.env`/GitHub Actions snippets that never contain secret values.
- **Global search and navigation:** `/search` finds a secret by path or a field by name across every
  readable project/environment, with a deep link for each result. Recent secrets (this tab) and
  starred favorites (this browser) are kept as **paths only** — no values are persisted. A ⌘K/Ctrl+K
  command palette (also available from the topbar) jumps to routes, recents and favorites or starts a
  search, with keyboard-only navigation.
- **Visual access control:** `/access` starts from Viewer/Developer/Admin role templates scoped to a
  project (and optionally one environment), writes the resulting ACL policy to OpenBao, and offers a
  visual rule editor that round-trips through the exact HCL that is saved. The **access simulator**
  checks real capabilities by minting a short-lived token, querying `sys/capabilities` and revoking
  the token immediately; it falls back to a local HCL estimate when the current token cannot mint
  one. No simulation token value is shown or stored. The **machine identities** tab generates
  AppRole, Kubernetes, JWT/OIDC and cloud-IAM setup commands for a chosen set of policies — without
  embedding credentials or secret values.
- **Audit log viewer:** `/audit` searches and filters the local OpenBao audit trail by actor, action,
  path text and time range, with deep links back to the affected secret and a metadata-only CSV copy
  button. Only actor/operation/path/time/result are read from the log — never secret values.
- **Recent activity:** a non-blocking "who changed this" panel on each secret, built from the same
  audit bridge. It degrades quietly when the local log is unavailable.
- **Permission-aware UI:** capabilities are fetched from `sys/capabilities-self`; unreadable
  environments, write actions, runbooks and TOTP admin actions are disabled with a real explanation.
- **Deep links:** every important view has stable query parameters (see `AGENTS.md`).

## Run locally

Prerequisites: Node 20+, pnpm, and a running OpenBao. The existing POC container is used as-is.

```bash
# 1. Start and unseal the local POC (if not already running)
podman start openbao-poc
KEY=$(jq -r '.unseal_keys_b64[0]' ../openbao-poc/.secrets/init.json)
curl -fsS -X PUT -H 'Content-Type: application/json' \
  -d "{\"key\":\"$KEY\"}" http://127.0.0.1:8200/v1/sys/unseal

# 2. Seed a dedicated demo project (idempotent)
pnpm install
./scripts/seed.sh

# 3. Start the console
pnpm dev
```

Open <http://127.0.0.1:5173>.

The dev server proxies `/v1/*` to `http://127.0.0.1:8200`, so no CORS changes are needed locally.
Override the proxy target with `VITE_BAO_TARGET=http://host:8200 pnpm dev`. It also exposes a
**dev-only** `/api/audit?path=...` bridge that reads the last 4,000 lines of the local container's
audit log through `podman exec` (or `docker exec`) and returns only actor/operation/path/time. Set
`VITE_BAO_CONTAINER` if the container is not named `openbao-poc`. This endpoint is never included in
a production build; do not expose it outside localhost. A production build has no proxy: point the
console at an OpenBao address that allows the console origin in its CORS config.

Sign in with either:

- **Root token** from `../openbao-poc/.secrets/init.json` (full access), or
- **`ui-manager` / `demo-only`** (dev-only read-only manager: dev+staging secrets, TOTP codes).

The manager login is useful for checking that the UI hides production and admin actions instead of
showing errors after a click. On **One-time codes** it demonstrates the no-list fallback: instead of
a permission error, the page asks for the account name. Enter `ui-demo--example-console` to see a
live code — copying works, while delete and create stay disabled with a clear explanation.

## Security posture

- The token lives in `sessionStorage` (tab-scoped), never `localStorage`, and is cleared on sign-out.
- Secrets are masked by default; reveal state is component-local and never persisted.
- Secret values are never put in URLs, generated commands, or console logs.
- `.env` copy is an explicit user action and uses shell-safe quoting.
- The frontend is a static build; no backend proxy stores or forwards tokens. The local audit bridge
  returns metadata only and is served solely by the dev server on `127.0.0.1`.

For real deployments, terminate TLS in front of OpenBao, set CORS explicitly, and use short-lived
OIDC tokens. Do not use the `ui-manager` password outside local development.

## Project layout

```
src/
  lib/            API facade, auth, capabilities, formatting, snippets, query hooks,
                  secret formats and metadata helpers
  components/     common primitives (from Dough) + app shell
  features/
    auth/         login + unseal
    secrets/      env-aware KV, credentials, spreadsheet editor, promotion,
                  compare, recent activity
    runbooks/     operational notes with deep links to secrets
    totp/         one-time codes
    automation/   agent-facing commands and capability inspector
  routes/         TanStack Router route tree
  styles/         Dough tokens/themes + console layout CSS
scripts/seed.sh   idempotent ui-demo fixture
```

## Checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Deliberately out of scope for this slice

OIDC login callback, policy/identity/OIDC-provider editors, mounts/plugins/raft settings,
namespaces management, i18n, and a formal component-library package. These belong in later slices,
driven by real usage. Audit is represented only by the read-only recent-activity panel above.

## Roadmap candidates

1. OIDC login with callback + role selection — unblocks managers in OIDC-based teams.
2. A proper audit settings/explorer view (the current panel is a local, read-only slice).
3. Component extraction into a small shared package if another community UI wants to reuse it.
