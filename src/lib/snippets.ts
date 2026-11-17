import { envFile } from './format';

export function baoCliSnippet(dataPath: string): string {
  // dataPath is an API path under kv/data, e.g. roomsss/env/development/app
  const kvPath = dataPath.replace(/^kv\/data\//, '');
  return `bao kv get -mount=kv -format=json ${kvPath}`;
}

export function curlSnippet(dataPath: string): string {
  return [
    `# BAO_TOKEN comes from your login/identity provider — never commit it`,
    `curl -fsS \\`,
    `  -H "X-Vault-Token: $BAO_TOKEN" \\`,
    `  "$BAO_ADDR/v1/kv/data/${dataPath}" \\`,
    `  | jq -r '.data.data'`,
  ].join('\n');
}

export function envPullSnippet(dataPath: string): string {
  const kvPath = dataPath.replace(/^kv\/data\//, '');
  return [
    `# Writes a 0600 .env from the selected secret`,
    `bao kv get -mount=kv -format=json ${kvPath} \\`,
    `  | jq -r '.data.data | to_entries[] | "\\(.key)=\\(.value|@sh)"' > .env`,
    `chmod 600 .env`,
  ].join('\n');
}

export function githubActionsSnippet(dataPath: string): string {
  const kvPath = dataPath.replace(/^kv\/data\//, '');
  return [
    `- name: Read ${kvPath} from OpenBao`,
    `  env:`,
    `    BAO_ADDR: \${{ vars.BAO_ADDR }}`,
    `  run: |`,
    `    bao login -method=oidc -role=github-actions`,
    `    bao kv get -mount=kv -format=json ${kvPath} > config.json`,
  ].join('\n');
}

export function secretsToEnvFile(data: Record<string, unknown>): string {
  return envFile(data);
}
