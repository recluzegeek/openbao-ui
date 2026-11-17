# AGENTS.md — driving this console and its OpenBao backend

This file is for coding agents and automation. The UI is deliberately machine-friendly: stable URLs,
semantic HTML, explicit `data-testid` hooks, and no hidden state.

## Routes and deep links

| Route | Purpose | Search params |
| --- | --- | --- |
| `/login` | token/userpass sign-in, sealed-server unseal | — |
| `/secrets` | environment-aware KV browser | `project`, `env`, `service` |
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
kv/data/<project>/env/<env>/<service>            read/write a secret
kv/data/<project>/creds/<name>                   shared credentials
totp/keys/                                       list TOTP accounts
totp/code/<project>--<account>                   read current code
totp/keys/<project>--<account>                   account config / admin
```

The API facade is `src/lib/api.ts`. It prefixes `/v1/`, adds `X-Vault-Token` and
`X-Vault-Namespace`, and throws `BaoError` with the HTTP status. Do not add a separate proxy.

## Capability gating

All action buttons use `sys/capabilities-self` through `useCapabilities()`.
`can(map, path, capability)` returns `false` when the map is not loaded, so the UI fails closed.
When adding a new action, add its path to `capabilityPathsForSecret()` or `totpCapabilityPaths()`.

## Useful test IDs

- `field-<name>` — a secret field row
- `code-<account>` / `code-value-<account>` — TOTP card and value
- copy buttons use `data-testid="copy-<label>"`

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
