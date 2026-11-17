import { describe, expect, it } from 'vitest';
import { can, deniedReason } from './capabilities';
import { envRank, parseTotpAccount, secretPath, totpCodePath } from './baoPaths';
import { envFile, formatTtl, parsePeriod, secondsUntil, shellQuote, tokenTtlLabel } from './format';
import { baoCliSnippet, curlSnippet } from './snippets';
import { dataFromRows, rowsFromData, validSecretName, validateRows } from './secretForm';
import { capabilityPathsForSecret } from './queries';
import { actorLabel, auditCsv, auditPathHref, filterAuditEntries, operationLabel, type AuditEntry, type AuditFilters } from './audit';
import { buildSecretTree, folderBreadcrumbs, folderInTree, validSecretPath } from './secretTree';
import { buildReferenceLookup, findReferences, parseKeyValueText, resolveReferences, serializeKeyValue } from './secretFormats';
import { effectiveValue, mergeAnnotations, overridesFor, parseAnnotations, withOverridesFor } from './secretMetadata';
import { actorForVersion, diffData } from './secretDiff';
import { isFavorite, loadFavorites, loadRecent, pushRecent, secretHref, toggleFavorite } from './navigationMemory';
import {
  generateHcl,
  globMatches,
  parseHcl,
  simulateCapabilities,
  templateRules,
} from './policy';
import { identitySnippets } from './machineIdentity';

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

  it('filters audit entries by actor, action, path text and time range', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    const entries: AuditEntry[] = [
      { time: '2026-01-01T11:55:00Z', operation: 'update', path: 'kv/data/ui-demo/env/development/web', displayName: 'root' },
      { time: '2026-01-01T10:00:00Z', operation: 'read', path: 'kv/data/ui-demo/env/production/web', displayName: 'ui-manager' },
      { time: '2025-12-30T10:00:00Z', operation: 'delete', path: 'kv/data/other/env/dev/web', displayName: 'root' },
    ];
    const base: AuditFilters = { search: '', actor: 'all', operation: 'all', range: 'all' };
    expect(filterAuditEntries(entries, base, now)).toHaveLength(3);
    expect(filterAuditEntries(entries, { ...base, actor: 'root' }, now)).toHaveLength(2);
    expect(filterAuditEntries(entries, { ...base, operation: 'read' }, now)).toHaveLength(1);
    expect(filterAuditEntries(entries, { ...base, search: 'production/web' }, now).map((e) => e.displayName)).toEqual(['ui-manager']);
    expect(filterAuditEntries(entries, { ...base, range: '1h' }, now)).toHaveLength(1);
    expect(filterAuditEntries(entries, { ...base, range: '24h' }, now)).toHaveLength(2);
  });

  it('exports metadata-only CSV with escaped cells', () => {
    const csv = auditCsv([{ time: 't', operation: 'update', path: 'a,"b"', displayName: 'dev', allowed: false }]);
    expect(csv.split('\n')[0]).toBe('time,actor,operation,path,result');
    expect(csv).toContain('"a,""b"""');
    expect(csv).toContain('"denied"');
    expect(csv).not.toMatch(/password|value=/i);
  });

  it('links audit paths back to the secrets browser without leaking values', () => {
    expect(auditPathHref('kv/data/ui-demo/env/development/web')).toBe('/secrets?project=ui-demo&env=development&service=web');
    expect(auditPathHref('kv/data/ui-demo/env/staging/database/postgres')).toBe(
      '/secrets?project=ui-demo&env=staging&service=database%2Fpostgres&folder=database',
    );
    expect(auditPathHref('sys/policies/acl/ui-demo-viewer')).toBeNull();
    expect(auditPathHref(undefined)).toBeNull();
  });
});

describe('secret formats', () => {
  it('parses .env files with export, quotes and comments', () => {
    const result = parseKeyValueText(
      ['# generated', 'export API_KEY="abc 123"', 'EMPTY=', "RAW='single'", 'MISSING'].join('\n'),
      'env',
    );
    expect(result.error).toMatch(/MISSING/);
    expect(parseKeyValueText('export API_KEY="abc 123"\nEMPTY=\nRAW=\'single\'', 'env').data).toEqual({
      API_KEY: 'abc 123',
      EMPTY: '',
      RAW: 'single',
    });
  });

  it('flattens nested JSON and parses YAML block scalars', () => {
    expect(parseKeyValueText('{"db":{"host":"pg"},"FLAG":true}', 'json').data).toEqual({
      'db.host': 'pg',
      FLAG: 'true',
    });
    expect(parseKeyValueText('KEY: value # note\nMULTI: |\n  line one\n  line two', 'yaml').data).toEqual({
      KEY: 'value',
      MULTI: 'line one\nline two',
    });
  });

  it('parses pasted TSV/spreadsheet rows', () => {
    expect(parseKeyValueText('HOST\tpg.internal\nPORT\t5432', 'tsv').data).toEqual({ HOST: 'pg.internal', PORT: '5432' });
    expect(parseKeyValueText('HOST,pg.internal', 'tsv').data).toEqual({ HOST: 'pg.internal' });
  });

  it('round-trips values through export formats', () => {
    const data = { HOST: 'pg.internal', MULTI: 'line one\nline two' };
    expect(parseKeyValueText(serializeKeyValue(data, 'json'), 'json').data).toEqual(data);
    expect(parseKeyValueText(serializeKeyValue(data, 'yaml'), 'yaml').data).toEqual(data);
    expect(serializeKeyValue({ A: 'x y' }, 'env')).toBe('A="x y"');
    expect(serializeKeyValue({ A: 'x y' }, 'tsv')).toBe('A\tx y');
  });

  it('finds and resolves ${path.FIELD} references', () => {
    const value = '${database/postgres.HOST}:${database/postgres.PORT}';
    const lookup = buildReferenceLookup([
      { path: 'database/postgres', data: { HOST: 'pg.internal', PORT: 5432 } },
    ]);
    expect(findReferences(value)).toEqual(['database/postgres.HOST', 'database/postgres.PORT']);
    expect(resolveReferences(value, lookup)).toBe('pg.internal:5432');
    expect(resolveReferences('${missing.FIELD}', lookup)).toBe('${missing.FIELD}');
  });
});

describe('secret annotations', () => {
  it('round-trips tags, notes, comments and personal overrides', () => {
    const annotations = parseAnnotations({
      ui_tags: '["db","critical"]',
      ui_note: 'Rotate weekly',
      ui_comments: '{"PASSWORD":"ask the DBA"}',
      ui_overrides: '{"ui-manager":{"PASSWORD":"local"}}',
      rotation_notes: 'keep me',
    });
    expect(annotations.tags).toEqual(['db', 'critical']);
    expect(annotations.comments.PASSWORD).toBe('ask the DBA');
    expect(overridesFor(annotations, 'ui-manager')).toEqual({ PASSWORD: 'local' });

    const written = mergeAnnotations({ rotation_notes: 'keep me' }, withOverridesFor(annotations, 'root', { HOST: 'mine' }));
    expect(written.rotation_notes).toBe('keep me');
    expect(parseAnnotations(written).overrides).toHaveProperty('ui-manager');
    expect(parseAnnotations(written).overrides).toHaveProperty('root');
    expect(effectiveValue('PASSWORD', 'stored', overridesFor(annotations, 'ui-manager'))).toBe('local');
    expect(effectiveValue('HOST', 'stored', {})).toBe('stored');
  });

  it('ignores malformed metadata instead of crashing', () => {
    expect(parseAnnotations({ ui_tags: 'not json', ui_comments: '[]' })).toEqual({
      tags: [], note: '', comments: {}, overrides: {},
    });
  });
});

describe('version diffs', () => {
  it('classifies added, removed, changed and unchanged fields', () => {
    const diff = diffData({ HOST: 'old', GONE: 'x', SAME: 'y' }, { HOST: 'new', SAME: 'y', FRESH: 'z' });
    expect(diff.map((item) => [item.key, item.status])).toEqual([
      ['FRESH', 'added'],
      ['GONE', 'removed'],
      ['HOST', 'changed'],
      ['SAME', 'same'],
    ]);
    expect(diff.find((item) => item.key === 'HOST')).toEqual({ key: 'HOST', status: 'changed', left: 'old', right: 'new' });
  });

  it('attributes a version time to the nearest write in the audit log', () => {
    const entries = [
      { time: '2026-11-17T10:00:00Z', operation: 'read', displayName: 'reader' },
      { time: '2026-11-17T10:01:00Z', operation: 'update', displayName: 'root' },
      { time: '2026-11-17T10:30:00Z', operation: 'update', displayName: 'other' },
    ];
    expect(actorForVersion(entries, '2026-11-17T10:01:10Z')).toBe('root');
    expect(actorForVersion(entries, '2026-11-17T09:00:00Z')).toBeUndefined();
  });
});

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

describe('policy builder', () => {
  it('round-trips visual rules through HCL', () => {
    const rules = templateRules('developer', 'ui-demo', 'development');
    const parsed = parseHcl(generateHcl(rules));
    expect(parsed.error).toBeUndefined();
    expect(parsed.rules).toEqual(rules);
  });

  it('scopes templates by project and environment', () => {
    const viewer = templateRules('viewer', 'ui-demo', 'staging');
    expect(viewer.some((rule) => rule.path === 'kv/data/ui-demo/env/staging/*')).toBe(true);
    expect(viewer.some((rule) => rule.path === 'kv/data/other/env/staging/*')).toBe(false);
    expect(viewer.every((rule) => !rule.capabilities.includes('create'))).toBe(true);
    const admin = templateRules('admin', 'ui-demo');
    expect(admin.find((rule) => rule.path === 'kv/data/ui-demo/env/*')?.capabilities).toEqual(
      expect.arrayContaining(['create', 'read', 'update', 'delete']),
    );
    expect(admin.some((rule) => rule.path.startsWith('totp/keys/ui-demo--'))).toBe(true);
  });

  it('matches trailing-star prefixes the way this OpenBao build does', () => {
    expect(globMatches('kv/data/ui-demo/env/*', 'kv/data/ui-demo/env/web')).toBe(true);
    expect(globMatches('kv/data/ui-demo/env/*', 'kv/data/ui-demo/env/api/gateway')).toBe(true);
    expect(globMatches('kv/data/ui-demo/env/development/*', 'kv/data/ui-demo/env/production/web')).toBe(false);
    expect(globMatches('totp/code/ui-demo--*', 'totp/code/ui-demo--example-console')).toBe(true);
    // `**`, mid-path `*` and `?` are literal in this build, not wildcards.
    expect(globMatches('kv/data/ui-demo/env/**', 'kv/data/ui-demo/env/api/gateway')).toBe(false);
    expect(globMatches('kv/data/ui-demo/env/*/web', 'kv/data/ui-demo/env/development/web')).toBe(false);
    expect(globMatches('totp/code/ui-demo--????', 'totp/code/ui-demo--abcd')).toBe(false);
  });

  it('estimates capabilities and honours deny rules', () => {
    const rules = templateRules('developer', 'ui-demo', 'development');
    expect(simulateCapabilities(rules, 'kv/data/ui-demo/env/development/web')).toEqual(
      expect.arrayContaining(['create', 'read', 'update', 'delete']),
    );
    expect(simulateCapabilities(rules, 'kv/data/ui-demo/env/production/web')).toEqual([]);
    expect(simulateCapabilities([...rules, { path: 'kv/data/ui-demo/env/*', capabilities: ['deny'] }], 'kv/data/ui-demo/env/development/web')).toEqual(['deny']);
  });

  it('reports malformed HCL instead of guessing', () => {
    expect(parseHcl('path "kv/data/x" {\n capabilities = ["read"]\n').error).toMatch(/Unclosed/);
    expect(parseHcl('garbage').error).toMatch(/Cannot parse line/);
    expect(parseHcl('path "kv/data/x" {\n}\n').error).toMatch(/no capabilities/);
  });
});

describe('machine identity snippets', () => {
  it('generates scoped commands for every auth method', () => {
    const options = { name: 'ci-deploy', policies: ['ui-demo-viewer'], serviceAccount: 'deploy', namespace: 'apps', audience: 'openbao', issuer: 'https://id.example.com', roleArn: 'arn:aws:iam::1:role/ci' };
    for (const kind of ['approle', 'kubernetes', 'jwt-oidc', 'cloud'] as const) {
      const snippets = identitySnippets(kind, options);
      expect(snippets.cli).toContain('ci-deploy');
      expect(snippets.cli).toContain('ui-demo-viewer');
      expect(snippets.http).toContain('X-Vault-Token');
      expect(snippets.notes.length).toBeGreaterThan(0);
    }
    expect(identitySnippets('kubernetes', options).cli).toContain('bound_service_account_namespaces="apps"');
    expect(identitySnippets('jwt-oidc', options).cli).toContain('bound_audiences="openbao"');
    expect(identitySnippets('cloud', { ...options, cloudProvider: 'aws' }).cli).toContain('auth_type="iam"');
  });

  it('never embeds credential values in generated commands', () => {
    const snippets = identitySnippets('approle', { name: 'ci', policies: ['p'] });
    expect(snippets.cli + snippets.http).not.toContain('secret_id=');
    expect(snippets.cli).toContain('bao write -f');
  });
});

describe('navigation memory', () => {
  it('keeps recent paths without values and deduplicates them', () => {
    const storage = memoryStorage();
    storage.clear();
    const ref = { project: 'ui-demo', env: 'development', path: 'web' };
    pushRecent(ref, storage);
    pushRecent(ref, storage);
    pushRecent({ ...ref, path: 'billing' }, storage);
    expect(loadRecent(storage).map((item) => item.path)).toEqual(['billing', 'web']);
    expect(secretHref({ ...ref, visitedAt: 0 })).toBe('/secrets?project=ui-demo&env=development&service=web');
    expect(secretHref({ ...ref, path: 'database/postgres', visitedAt: 0 })).toContain('folder=database');
  });

  it('toggles favorites by path', () => {
    const storage = memoryStorage();
    storage.clear();
    const ref = { project: 'ui-demo', env: 'staging', path: 'web', key: 'API_KEY' };
    toggleFavorite(ref, storage);
    expect(loadFavorites(storage)).toHaveLength(1);
    expect(isFavorite(ref, loadFavorites(storage))).toBe(true);
    toggleFavorite(ref, storage);
    expect(loadFavorites(storage)).toHaveLength(0);
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
