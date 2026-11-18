import { envFile } from './format';
import { DEFAULT_KV_MOUNT, kvDataField, kvDataPath, type KvMountInfo } from './kvMounts';

/** Strip the conventional v2 data prefix so callers can pass API paths or bare logical paths. */
function logical(dataPath: string): string {
  return dataPath.replace(/^kv\/data\//, '');
}

/** All snippet generators are credential-free: the token always comes from the caller's environment. */
export function baoCliSnippet(dataPath: string, mount: KvMountInfo = DEFAULT_KV_MOUNT): string {
  return `bao kv get -mount=${mount.path} -format=json ${logical(dataPath)}`;
}

export function curlSnippet(dataPath: string, mount: KvMountInfo = DEFAULT_KV_MOUNT): string {
  return [
    `# BAO_TOKEN comes from your login/identity provider — never commit it`,
    `curl -fsS \\`,
    `  -H "X-Vault-Token: $BAO_TOKEN" \\`,
    `  "$BAO_ADDR/v1/${kvDataPath(mount, logical(dataPath))}" \\`,
    `  | jq -r '.${kvDataField(mount)}'`,
  ].join('\n');
}

export function envPullSnippet(dataPath: string, mount: KvMountInfo = DEFAULT_KV_MOUNT): string {
  return [
    `# Writes a 0600 .env from the selected secret`,
    `bao kv get -mount=${mount.path} -format=json ${logical(dataPath)} \\`,
    `  | jq -r '.${kvDataField(mount)} | to_entries[] | "\\(.key)=\\(.value|@sh)"' > .env`,
    `chmod 600 .env`,
  ].join('\n');
}

export function githubActionsSnippet(dataPath: string, mount: KvMountInfo = DEFAULT_KV_MOUNT): string {
  const path = logical(dataPath);
  return [
    `- name: Read ${path} from OpenBao`,
    `  env:`,
    `    BAO_ADDR: \${{ vars.BAO_ADDR }}`,
    `  run: |`,
    `    bao login -method=oidc -role=github-actions`,
    `    bao kv get -mount=${mount.path} -format=json ${path} > config.json`,
  ].join('\n');
}

export function secretsToEnvFile(data: Record<string, unknown>): string {
  return envFile(data);
}
