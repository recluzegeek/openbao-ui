import { describe, expect, it } from 'vitest';
import { can, deniedReason } from './capabilities';
import { envRank, parseTotpAccount, secretPath, totpCodePath } from './baoPaths';
import { envFile, formatTtl, parsePeriod, secondsUntil, shellQuote, tokenTtlLabel } from './format';
import { baoCliSnippet, curlSnippet } from './snippets';
import { dataFromRows, rowsFromData, validSecretName, validateRows } from './secretForm';
import { capabilityPathsForSecret } from './queries';
import { actorLabel, operationLabel } from './audit';
import { buildSecretTree, folderBreadcrumbs, folderInTree, validSecretPath } from './secretTree';

describe('OpenBao paths', () => {
  it('builds the POC KV layout', () => {
    expect(secretPath('roomsss', 'development', 'app')).toBe('kv/data/roomsss/env/development/app');
    expect(totpCodePath('roomsss--aws-console')).toBe('totp/code/roomsss--aws-console');
  });

  it('parses TOTP account names and ranks environments', () => {
    expect(parseTotpAccount('roomsss--aws console')).toEqual({ project: 'roomsss', account: 'aws console' });
    expect(parseTotpAccount('plain')).toEqual({ project: 'other', account: 'plain' });
    expect(['production', 'development', 'staging'].sort(envRank)).toEqual(['development', 'staging', 'production']);
  });
});

describe('capabilities', () => {
  it('allows sudo and denies missing paths without crashing', () => {
    const map = { 'kv/data/a/env/dev/app': ['read', 'sudo'] };
    expect(can(map, 'kv/data/a/env/dev/app', 'delete')).toBe(true);
    expect(can(map, 'kv/data/a/env/prod/app', 'read')).toBe(false);
    expect(can(undefined, 'kv/data/a/env/dev/app', 'read')).toBe(false);
    expect(can({ 'kv/data/a/env/dev/app': ['root'] }, 'kv/data/a/env/dev/app', 'delete')).toBe(true);
  });

  it('reports a clear reason for deny-only paths without suggesting available actions', () => {
    const denied = { 'totp/code/ui-demo--example-console': ['deny'] };
    expect(can(denied, 'totp/code/ui-demo--example-console', 'read')).toBe(false);
    expect(deniedReason(denied, 'totp/code/ui-demo--example-console', 'read')).toBe(
      'Your token has no access to this path.',
    );
    expect(deniedReason({ 'kv/data/a': ['root'] }, 'kv/data/a', 'delete')).toBe(
      'Your token has full access to this path.',
    );
  });
});

describe('secret editor', () => {
  it('round-trips rows and rejects duplicate or empty names', () => {
    const rows = rowsFromData({ DB_PASSWORD: 'p@ss', FLAG: true });
    expect(rows.map((r) => r.key)).toEqual(['DB_PASSWORD', 'FLAG']);
    expect(dataFromRows(rows)).toEqual({ DB_PASSWORD: 'p@ss', FLAG: 'true' });
    expect(validateRows(rows)).toBeNull();
    expect(validateRows([...rows, { id: 'x', key: 'DB_PASSWORD', value: 'again' }])).toBe(
      'Duplicate field name: DB_PASSWORD',
    );
    expect(validateRows([{ id: 'y', key: '  ', value: 'x' }])).toBe('Every field needs a name.');
  });

  it('accepts single-segment secret names only', () => {
    expect(validSecretName(' web ')).toBe(true);
    expect(validSecretName('a/b')).toBe(false);
    expect(validSecretName('..')).toBe(false);
    expect(validSecretName('   ')).toBe(false);
  });

  it('probes a new-secret path so create capability can be gated', () => {
    const paths = capabilityPathsForSecret('ui-demo', 'development', 'web', ['development', 'staging']);
    expect(paths).toContain('kv/data/ui-demo/env/development/__new__');
    expect(paths).toContain('kv/data/ui-demo/env/development/web');
    expect(paths).toContain('kv/data/ui-demo/env/staging/web');
  });
});

describe('folder model', () => {
  it('builds a folder tree from flat KV paths', () => {
    const tree = buildSecretTree(['web', 'billing', 'database/postgres', 'database/replica', 'api/deep/gateway']);
    expect(tree.secrets).toEqual(['billing', 'web']);
    expect(tree.folders.map((folder) => folder.name)).toEqual(['api', 'database']);
    expect(folderInTree(tree, 'database')?.secrets).toEqual(['database/postgres', 'database/replica']);
    expect(folderInTree(tree, 'api/deep')?.secrets).toEqual(['api/deep/gateway']);
  });

  it('builds breadcrumbs and validates relative secret paths', () => {
    expect(folderBreadcrumbs('api/deep')).toEqual([
      { label: 'Root', path: '' },
      { label: 'api', path: 'api' },
      { label: 'deep', path: 'api/deep' },
    ]);
    expect(validSecretPath('database/postgres')).toBe(true);
    expect(validSecretPath('/database/')).toBe(false);
    expect(validSecretPath('a/../b')).toBe(false);
  });
});

describe('audit trail', () => {
  it('turns audit fields into readable activity text without exposing values', () => {
    expect(operationLabel('update')).toBe('changed');
    expect(operationLabel('delete')).toBe('deleted');
    expect(operationLabel(undefined)).toBe('requested');
    expect(actorLabel({ time: '', displayName: 'root' })).toBe('root');
    expect(actorLabel({ time: '', policies: ['ui-demo-manager'] })).toBe('token (ui-demo-manager)');
    expect(actorLabel({ time: '' })).toBe('unknown token');
  });
});

describe('secret-safe formatting', () => {
  it('quotes shell values and builds a valid .env', () => {
    expect(shellQuote('plain_value')).toBe('plain_value');
    expect(shellQuote("a b'c")).toBe("'a b'\\''c'");
    expect(envFile({ DB_PASSWORD: 'p@ss word', '1INVALID': 'x' })).toBe("DB_PASSWORD='p@ss word'");
  });

  it('never embeds secret values in agent snippets', () => {
    const path = 'roomsss/env/development/app';
    expect(baoCliSnippet(`kv/data/${path}`)).not.toContain('p@ss');
    expect(curlSnippet(path)).not.toContain('p@ss');
    expect(curlSnippet(path)).toContain('$BAO_TOKEN');
  });

  it('computes TOTP countdown', () => {
    const now = 1_000_000;
    expect(secondsUntil(new Date(now + 9_000).toISOString(), now)).toBe(9);
    expect(secondsUntil(undefined, now)).toBe(0);
    expect(secondsUntil(Math.floor(1_000_000 / 1000) + 9, now)).toBe(9);
    expect(parsePeriod('30s')).toBe(30);
  });

  it('does not call non-expiring tokens expired', () => {
    expect(formatTtl(0)).toBe('expired');
    expect(tokenTtlLabel(['root'], 0, undefined)).toBe('no expiry (root)');
    expect(tokenTtlLabel(['default'], 0, undefined)).toBe('no expiry');
    expect(tokenTtlLabel(['default'], 900, '2026-11-17T12:00:00Z')).toBe('15m');
  });
});
