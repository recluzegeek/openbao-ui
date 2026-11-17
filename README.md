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
| Route coverage | Mostly stubs / 404s | Only the three first-slice surfaces |
| Architecture | No spec, many aspirational routes | One layout, three features, explicit paths |
| Onboarding for new contributors | Must learn generated client + aliases | Standard Vite/React/TS |
| Look and feel | Good tokens/components | Reused tokens + primitives |

The fork remains useful as a design reference; it is a poor base for a small, reviewable first slice.

## What is in this slice

- **Sign in:** token or userpass against any OpenBao address/namespace; sealed-server unseal flow.
  OIDC is visibly deferred rather than faked.
- **Secrets:** project → environment → service browsing, masked-by-default field reveal/copy,
  shared credentials, version history, safe `.env` copy, and promotion between environments with a
  destination preview and confirmation.
- **One-time codes (TOTP):** live codes with countdown, copy, admin create/delete; the seed is
  generated inside OpenBao and never displayed. If your token may read individual codes but cannot
  list every account (typical for managers), the page offers an **“Open a code by name”** panel:
  type the exact account name (for example `ui-demo--example-console`) to load just that code.
  Pinned names live in this browser tab only; codes are never stored.
- **For agents:** identity and policy summary, capability inspection for any path, and copyable
  CLI/cURL/`.env`/GitHub Actions snippets that never contain secret values.
- **Permission-aware UI:** capabilities are fetched from `sys/capabilities-self`; unreadable
  environments, write actions and TOTP admin actions are disabled with a real explanation.
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
Override the proxy target with `VITE_BAO_TARGET=http://host:8200 pnpm dev`. A production build has no
proxy: point the console at an OpenBao address that allows the console origin in its CORS config.

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
- The frontend is a static build; no backend proxy stores or forwards tokens.

For real deployments, terminate TLS in front of OpenBao, set CORS explicitly, and use short-lived
OIDC tokens. Do not use the `ui-manager` password outside local development.

## Project layout

```
src/
  lib/            API facade, auth, capabilities, formatting, snippets, query hooks
  components/     common primitives (from Dough) + app shell
  features/
    auth/         login + unseal
    secrets/      env-aware KV, credentials, promotion
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

OIDC login callback, policy/identity/OIDC-provider editors, mounts/plugins/audit/raft settings,
secret editing in the browser (read + promote only), namespaces management, i18n, and a formal
component-library package. These belong in later slices, driven by real usage.

## Roadmap candidates

1. OIDC login with callback + role selection — unblocks managers in OIDC-based teams.
2. Secret create/edit with CAS and a structured form, gated by capabilities.
3. Runbooks view (`kv/_runbooks/*`) linked from each service.
4. Audit-aware "who changed this" panel using the existing audit log.
5. Component extraction into a small shared package if another community UI wants to reuse it.
