import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { can, canAny, deniedReason } from './capabilities';
import { envRank, parseTotpAccount, runbookApiPath, runbookMetadataPath, secretPath, totpCodePath } from './baoPaths';
import { envFile, formatTtl, parsePeriod, secondsUntil, shellQuote, tokenTtlLabel } from './format';
import { baoCliSnippet, curlSnippet, envPullSnippet } from './snippets';
import { dataFromRows, fieldNameError, rowsFromData, validSecretName, validateRows } from './secretForm';
import { bao, normalizeNamespace, request, setBaoConfig } from './api';
import { mergeEffectivePolicies } from './auth';
import { sessionSecondsLeft } from './session';
import { shareLinkFor, validWrapTtl, wrappingTokenFromHash } from './wrapping';
import { appRoleCapabilityPaths, capabilityPathsForFolder, capabilityPathsForSecret, environmentCreationTarget, kvBrowserCapabilityPaths, runbookCapabilityPaths } from './queries';
import { kvDataField, kvDataPath, kvListPath, kvMountsFromMap, kvSupportsVersions, type KvMountInfo } from './kvMounts';
import { environmentMarkerPath, inferLayout, physicalPath, type ClassifiedSecret, type LayoutProfile } from './layout';
import { clearProjectLayouts, registerProjectLayout, resolveApiPath, resolveEnvMetadataPath, toLogicalPath } from './layoutResolver';
import { actorLabel, auditCsv, auditPathHref, filterAuditEntries, operationLabel, type AuditEntry, type AuditFilters } from './audit';
import { buildSecretTree, folderBreadcrumbs, folderInTree, validSecretPath } from './secretTree';
import { environmentTabs, groupFieldsByPrefix } from './secretGroups';
import { buildReferenceLookup, findReferences, parseKeyValueText, resolveReferences, serializeKeyValue } from './secretFormats';
import { effectiveValue, mergeAnnotations, overridesFor, parseAnnotations, withOverridesFor } from './secretMetadata';
import { actorForVersion, diffData } from './secretDiff';
import { deletedVersions, durationError, versionSettingsFrom, versionState } from './secretLifecycle';
import { isFavorite, loadFavorites, loadRecent, pushRecent, secretHref, toggleFavorite } from './navigationMemory';
import {
  discoveredParents,
  envListMetadataPath,
  generateHcl,
  globMatches,
  inferRolePolicyNames,
  parseHcl,
  projectPolicyNames,
  simulateCapabilities,
  simulatorPathsFromLayout,
  templateRules,
  templateRulesFromLayout,
} from './policy';
import { identitySnippets, validAppRoleName } from './machineIdentity';
import { deriveSetupStage, setupSnippets, SHORTCUTS } from './setup';

beforeEach(() => clearProjectLayouts());
afterEach(() => vi.restoreAllMocks());

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

  it('rejects invalid field names before saving', () => {
    expect(fieldNameError('DATABASE_URL')).toBeNull();
    expect(fieldNameError('api.timeout')).toBeNull();
    expect(fieldNameError('bad key!')).toMatch(/letters, numbers/i);
    expect(fieldNameError('1st place')).toMatch(/letters, numbers/i);
    expect(fieldNameError('-leading')).toMatch(/start with/i);
    expect(fieldNameError('a/b')).toMatch(/letters, numbers/i);
    expect(validateRows([{ id: 'x', key: 'bad key!', value: 'v' }])).toMatch(/letters, numbers/i);
  });

  it('probes a new-secret path so create capability can be gated', () => {
    const paths = capabilityPathsForSecret('ui-demo', 'development', 'web', ['development', 'staging']);
    expect(paths).toContain('kv/data/ui-demo/env/development/__new__');
    expect(paths).toContain('kv/data/ui-demo/env/development/web');
    expect(paths).toContain('kv/data/ui-demo/env/staging/web');
  });

  it('includes every lifecycle ACL path so Trash actions fail closed', () => {
    const paths = capabilityPathsForSecret('ui-demo', 'development', 'web');
    for (const prefix of ['kv/data/', 'kv/metadata/', 'kv/delete/', 'kv/undelete/', 'kv/destroy/']) {
      expect(paths).toContain(`${prefix}ui-demo/env/development/web`);
    }
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

  it('omits empty custom_metadata values so the metadata write cannot fail', () => {
    const empty = parseAnnotations(undefined);
    const written = mergeAnnotations({ rotation_notes: 'keep me' }, empty);
    expect(written.rotation_notes).toBe('keep me');
    expect('ui_note' in written).toBe(false);
    expect(parseAnnotations(written).note).toBe('');
    const withNote = mergeAnnotations(undefined, { ...empty, note: 'Rotate weekly' });
    expect(withNote.ui_note).toBe('Rotate weekly');
    // Clearing a note removes the key rather than writing an empty value.
    expect('ui_note' in mergeAnnotations(withNote, empty)).toBe(false);
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

  it('derives the live session countdown from expiry, TTL and "now"', () => {
    const now = 1_000_000;
    // expire_time is authoritative when present.
    expect(sessionSecondsLeft(new Date(now + 90_000).toISOString(), 3600, now)).toBe(90);
    // An already-expired token clamps to zero rather than going negative.
    expect(sessionSecondsLeft(new Date(now - 5_000).toISOString(), 3600, now)).toBe(0);
    // Without expire_time, fall back to the reported TTL and never go negative.
    expect(sessionSecondsLeft(undefined, 600, now)).toBe(600);
    expect(sessionSecondsLeft(undefined, -3, now)).toBe(0);
    // A token with no expiry and no TTL (root / periodic) has no countdown.
    expect(sessionSecondsLeft(undefined, undefined, now)).toBeNull();
    expect(sessionSecondsLeft(undefined, 0, now)).toBeNull();
  });
});

describe('getting-started setup', () => {
  const health = { initialized: true, sealed: false, standby: false, version: '1' };

  it('derives the setup stage from live server state in priority order', () => {
    expect(deriveSetupStage({})).toBe('checking');
    expect(deriveSetupStage({ healthFailed: true })).toBe('unreachable');
    expect(deriveSetupStage({ health: { ...health, initialized: false } })).toBe('uninitialized');
    expect(deriveSetupStage({ health, seal: { sealed: true } as never })).toBe('sealed');
    expect(deriveSetupStage({ health, kvMounted: false })).toBe('no-mount');
    expect(deriveSetupStage({ health, kvMounted: true })).toBe('checking');
    expect(deriveSetupStage({ health, kvMounted: true, projects: [] })).toBe('no-projects');
    expect(deriveSetupStage({ health, kvMounted: true, projects: ['ui-demo'] })).toBe('ready');
  });

  it('keeps setup commands free of secret values', () => {
    const all = Object.values(setupSnippets).join('\n');
    expect(all).toContain('bao operator init');
    expect(all).not.toMatch(/unseal_keys|root_token|secret_id|password=/i);
    expect(SHORTCUTS.some((s) => s.keys.includes('⌘K'))).toBe(true);
  });
});

describe('server-driven layout discovery', () => {
  it('returns full metadata paths from a recursive listing', async () => {
    const list = vi.spyOn(bao, 'list').mockImplementation(async (path) => {
      const keys: Record<string, string[]> = {
        'kv/metadata/tgc/': ['identity-service/'],
        'kv/metadata/tgc/identity-service/': ['development'],
      };
      return { data: { keys: keys[path] ?? [] } };
    });
    expect(await bao.listRecursive('tgc/')).toEqual(['tgc/identity-service/development']);
    expect(list).toHaveBeenCalledWith('kv/metadata/tgc/');
  });

  it('infers the legacy seeded layout without warnings', () => {
    const result = inferLayout([
      'ui-demo/env/development/web',
      'ui-demo/env/staging/database/postgres',
    ]);
    expect(result.profile.kind).toBe('legacy-env');
    expect(result.classified).toEqual([
      { physical: 'ui-demo/env/development/web', project: 'ui-demo', env: 'development', logical: 'web', component: '', source: 'heuristic' },
      { physical: 'ui-demo/env/staging/database/postgres', project: 'ui-demo', env: 'staging', logical: 'database/postgres', component: '', source: 'heuristic' },
    ]);
    expect(physicalPath(result.profile, 'ui-demo', 'development', 'web')).toBe('ui-demo/env/development/web');
    expect(environmentMarkerPath(result.profile, 'ui-demo', 'staging')).toBe('ui-demo/env/staging/__environment__');
    expect(result.warnings).toEqual([]);
  });

  it('uses custom metadata first, including JSON array labels', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = inferLayout(
      ['tgc/identity-service/development', 'tgc/backend-api/production/database/postgres'],
      {
        'tgc/identity-service/development': {
          ph_project: 'tgc', ph_scope_tabs: '["development"]', ph_component_tabs: '["identity-service"]',
        },
        'tgc/backend-api/production/database/postgres': {
          ph_project: 'tgc', ph_scope_tabs: '["production"]', ph_component_tabs: '["backend-api"]',
        },
      },
    );
    expect(result.profile.kind).toBe('project-repo-env');
    expect(result.classified[0]).toMatchObject({
      project: 'tgc', env: 'development', logical: 'identity-service', component: 'identity-service', source: 'metadata',
    });
    expect(result.classified[1]).toMatchObject({
      env: 'production', logical: 'backend-api/database/postgres', source: 'metadata',
    });
    expect(physicalPath(result.profile, 'tgc', 'development', 'identity-service')).toBe('tgc/identity-service/development');
    expect(physicalPath(result.profile, 'tgc', 'production', 'backend-api/database/postgres'))
      .toBe('tgc/backend-api/production/database/postgres');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns at warning level and keeps raw paths when heuristics disagree', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = inferLayout(
      ['tgc/web/custom-stage', 'random/tree/leaf'],
      { 'tgc/web/custom-stage': { ph_project: 'tgc', ph_scope_tabs: '["staging"]' } },
    );
    expect(result.warnings.some((message) => message.includes('Metadata environment "staging" disagrees'))).toBe(true);
    expect(result.warnings.some((message) => message.includes('No environment-like segment found in "random/tree/leaf"'))).toBe(true);
    expect(result.unclassified.map((item) => item.physical)).toContain('random/tree/leaf');
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join('\n')).toContain('[layout-discovery]');
  });

  it('falls back to a complete raw listing when no pattern matches', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = inferLayout(['alpha/beta/gamma']);
    expect(result.profile.kind).toBe('raw');
    expect(result.classified[0]).toMatchObject({
      physical: 'alpha/beta/gamma', env: '(unassigned)', logical: 'beta/gamma', source: 'raw',
    });
    expect(result.warnings.some((message) => message.includes('No layout pattern matched'))).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it('classifies an environment marker so an empty environment is discoverable', () => {
    const sample = inferLayout(['tgc/identity-service/development']);
    const marker = environmentMarkerPath(sample.profile, 'tgc', 'staging');
    const result = inferLayout([marker], { [marker]: { ui_env: 'staging', ui_owner: 'platform' } });
    expect(marker).toBe('tgc/__environment__/staging/__environment__');
    expect(result.classified[0]).toMatchObject({ physical: marker, env: 'staging', source: 'metadata' });
  });

  it('resolves logical paths back to discovered physical paths', () => {
    const layout = inferLayout(['tgc/identity-service/development']);
    registerProjectLayout('tgc', layout.profile, layout.classified);
    expect(resolveApiPath('tgc', 'development', 'identity-service')).toBe('tgc/identity-service/development');
    expect(toLogicalPath('tgc', 'kv/metadata/tgc/identity-service/development')).toBe('identity-service');
    expect(resolveEnvMetadataPath('tgc', 'development')).toBe('tgc');
    expect(environmentMarkerPath(layout.profile, 'tgc', 'staging')).toBe('tgc/__environment__/staging/__environment__');
    const target = environmentCreationTarget('tgc', 'staging', { ...layout, rawPaths: [], environments: [], markers: [] });
    expect(target?.dataPath).toBe('kv/data/tgc/__environment__/staging/__environment__');
    expect(target?.metadataPath).toBe('kv/metadata/tgc/__environment__/staging/__environment__');
  });

  it('probes capabilities on discovered paths for folders and new environments', () => {
    const layout = inferLayout(['tgc/identity-service/development/database/postgres']);
    registerProjectLayout('tgc', layout.profile, layout.classified);
    const paths = capabilityPathsForFolder(
      'tgc', 'development', 'identity-service/database',
      ['identity-service/database/postgres'], ['development', 'production'],
    );
    expect(paths).toContain('kv/data/tgc/identity-service/development/database/postgres');
    expect(paths).toContain('kv/metadata/tgc/identity-service/development/database/');
    expect(paths).toContain('kv/data/tgc/identity-service/development/database/__new__');
    expect(paths).toContain('kv/metadata/tgc/');
  });
});

describe('session hardening', () => {
  it('normalizes namespaces and rejects traversal', () => {
    expect(normalizeNamespace('  /team-a/  ')).toBe('team-a');
    expect(normalizeNamespace('team-a/child')).toBe('team-a/child');
    expect(normalizeNamespace('')).toBe('');
    expect(() => normalizeNamespace('../root')).toThrow(/letters, numbers/i);
    expect(() => normalizeNamespace('team a')).toThrow(/letters, numbers/i);
  });

  it('merges effective policies from resultant-acl', () => {
    expect(mergeEffectivePolicies(['default'], ['default', 'org-admin'])).toEqual({
      policies: ['default', 'org-admin'], effective: true,
    });
    expect(mergeEffectivePolicies(['default'], undefined)).toEqual({ policies: ['default'], effective: false });
  });

  it('treats an empty LIST 404 as no keys', async () => {
    setBaoConfig({ token: 'test-token' });
    const fetchStub = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '{"errors":[]}',
    } as unknown as Response);
    expect(await request('kv/metadata/empty/', { list: true })).toEqual({ data: null });
    expect(fetchStub).toHaveBeenCalled();
  });

  it('renews the current token lease without logging the token value', async () => {
    setBaoConfig({ token: 'test-token' });
    const fetchStub = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: async () => JSON.stringify({ data: { ttl: 3600, renewable: true, expire_time: '2026-11-19T00:00:00Z' } }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: async () => '{"data":{"ttl":3600,"renewable":true,"expire_time":"2026-11-19T00:00:00Z"}}',
      } as unknown as Response);

    const result = await bao.renewSelf('1h');
    const [url, init] = fetchStub.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toContain('/v1/auth/token/renew-self');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ increment: '1h' });
    expect(result.data.ttl).toBe(3600);
    expect(result.data.renewable).toBe(true);

    // Omitting the increment uses the mount's default lease.
    await bao.renewSelf();
    const [, defaultInit] = fetchStub.mock.calls[1] as unknown as [URL, RequestInit];
    expect(JSON.parse(String(defaultInit.body))).toEqual({});
  });

  it('patches a secret with HTTP PATCH on the data endpoint', async () => {
    setBaoConfig({ token: 'test-token' });
    const fetchStub = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"data":{"data":{},"metadata":{"version":3}}}',
    } as unknown as Response);
    await bao.patchSecret('tgc/env/development/app', { PORT: '8080' });
    const [url, init] = fetchStub.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toContain('/v1/kv/data/tgc/env/development/app');
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/merge-patch+json');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ data: { PORT: '8080' }, options: {} });
  });

  it('falls back to read-then-write when PATCH is not permitted', async () => {
    setBaoConfig({ token: 'test-token' });
    const fetchStub = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: false, status: 403, text: async () => '{"errors":["permission denied"]}',
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: async () => '{"data":{"data":{"HOST":"db","PORT":"5432"},"metadata":{"version":2}}}',
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: async () => '{"data":{"data":{},"metadata":{"version":3}}}',
      } as unknown as Response);
    await bao.patchSecret('tgc/env/development/app', { PORT: '8080' });
    expect(fetchStub).toHaveBeenCalledTimes(3);
    const [readUrl, readInit] = fetchStub.mock.calls[1] as unknown as [URL, RequestInit];
    expect(String(readUrl)).toContain('/v1/kv/data/tgc/env/development/app');
    expect(readInit.method).toBe('GET');
    const [writeUrl, writeInit] = fetchStub.mock.calls[2] as unknown as [URL, RequestInit];
    expect(String(writeUrl)).toContain('/v1/kv/data/tgc/env/development/app');
    expect(writeInit.method).toBe('POST');
    expect(JSON.parse(String(writeInit.body))).toEqual({
      data: { HOST: 'db', PORT: '8080' },
      options: { cas: 2 },
    });
  });

  it('sends a CAS option when a cas-required secret is patched', async () => {
    setBaoConfig({ token: 'test-token' });
    const fetchStub = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"data":{"data":{},"metadata":{"version":4}}}',
    } as unknown as Response);
    await bao.patchSecret('a/b', { X: '1' }, 3);
    const [, init] = fetchStub.mock.calls[0] as unknown as [URL, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ data: { X: '1' }, options: { cas: 3 } });
  });

  it('uses the correct KV v2 lifecycle endpoints and payloads', async () => {
    setBaoConfig({ token: 'test-token' });
    const fetchStub = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 204, text: async () => '',
    } as unknown as Response);

    await bao.softDeleteVersions('a/b', [1, 2]);
    await bao.undeleteVersions('a/b', [1]);
    await bao.destroyVersions('a/b', [2]);
    await bao.deleteLatestVersion('a/b');
    await bao.deleteSecretMetadata('a/b');

    const calls = fetchStub.mock.calls.map(([url, init]) => ({
      path: String(url).split('/v1/')[1],
      method: (init as RequestInit).method,
      body: (init as RequestInit).body ? JSON.parse(String((init as RequestInit).body)) : undefined,
      contentType: ((init as RequestInit).headers as Record<string, string>)['Content-Type'],
    }));
    expect(calls).toEqual([
      { path: 'kv/delete/a/b', method: 'POST', body: { versions: [1, 2] }, contentType: 'application/json' },
      { path: 'kv/undelete/a/b', method: 'POST', body: { versions: [1] }, contentType: 'application/json' },
      { path: 'kv/destroy/a/b', method: 'PUT', body: { versions: [2] }, contentType: 'application/json' },
      { path: 'kv/data/a/b', method: 'DELETE', body: undefined, contentType: undefined },
      { path: 'kv/metadata/a/b', method: 'DELETE', body: undefined, contentType: undefined },
    ]);
  });

  it('resets zero-value version settings via a full POST that preserves annotations', async () => {
    setBaoConfig({ token: 'test-token' });
    const fetchStub = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: async () => JSON.stringify({
          data: {
            max_versions: 7, cas_required: true, delete_version_after: '30d',
            custom_metadata: { owner: 'team-a' }, versions: {},
          },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' } as unknown as Response);

    // A merge-patch cannot reset these to zero, so the facade reads then POSTs
    // the complete settings object with custom_metadata preserved.
    await bao.patchMetadataSettings('a/b', { delete_version_after: '0s', max_versions: 0 });
    const calls = fetchStub.mock.calls.map(([url, init]) => ({
      path: String(url).split('/v1/')[1],
      method: (init as RequestInit).method ?? 'GET',
      body: (init as RequestInit).body ? JSON.parse(String((init as RequestInit).body)) : undefined,
    }));
    expect(calls[0]).toEqual({ path: 'kv/metadata/a/b', method: 'GET', body: undefined });
    expect(calls[1]).toEqual({
      path: 'kv/metadata/a/b',
      method: 'POST',
      body: { custom_metadata: { owner: 'team-a' }, max_versions: 0, cas_required: true, delete_version_after: '0s' },
    });
  });
});

describe('AppRole creation with show-once secret ID', () => {
  it('keeps role names to a safe path segment', () => {
    expect(validAppRoleName('ux-approle-1')).toBe(true);
    expect(validAppRoleName('ci.deploy_role')).toBe(true);
    expect(validAppRoleName('bad name')).toBe(false);
    expect(validAppRoleName('../root')).toBe(false);
    expect(validAppRoleName('a/b')).toBe(false);
    expect(validAppRoleName('')).toBe(false);
  });

  it('probes the enable and create capability paths', () => {
    expect(appRoleCapabilityPaths()).toEqual(['sys/auth/approle', 'auth/approle/role/__new__']);
  });

  it('enables, creates, reads role-id and generates a fresh secret ID on the right paths', async () => {
    setBaoConfig({ token: 'test-token' });
    const fetchStub = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ data: {} }) } as unknown as Response);

    await bao.enableAppRole();
    await bao.createAppRole('ux-ci', ['default', 'ux-viewer'], '1h');
    await bao.readAppRoleId('ux-ci');
    await bao.generateAppRoleSecretId('ux-ci');

    const calls = fetchStub.mock.calls.map(([url, init]) => ({
      url: String(url),
      method: (init as RequestInit).method ?? 'GET',
      body: (init as RequestInit).body ? JSON.parse(String((init as RequestInit).body)) : undefined,
    }));
    expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining([
      expect.stringContaining('/v1/sys/auth/approle'),
      expect.stringContaining('/v1/auth/approle/role/ux-ci'),
      expect.stringContaining('/v1/auth/approle/role/ux-ci/role-id'),
      expect.stringContaining('/v1/auth/approle/role/ux-ci/secret-id'),
    ]));
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({ type: 'approle' });
    expect(calls[1].body).toEqual({ token_policies: ['default', 'ux-viewer'], token_type: 'service', token_ttl: '1h' });
    expect(calls[2].method).toBe('GET');
    expect(calls[3].method).toBe('POST');
    expect(calls[3].body).toEqual({});
  });
});

describe('pre-login auth method detection', () => {
  it('reads auth mounts from sys/internal/ui/mounts without a token', async () => {
    const fetchStub = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true, status: 200,
      text: async () => JSON.stringify({
        data: {
          auth: { 'userpass/': { type: 'userpass', accessor: 'a' }, 'oidc/': { type: 'oidc' } },
          secret: {},
        },
      }),
    } as unknown as Response);

    setBaoConfig({ token: '' });
    try {
      const methods = await bao.detectAuthMethods();
      expect(methods).toEqual([
        { path: 'userpass', type: 'userpass', accessor: 'a' },
        { path: 'oidc', type: 'oidc', accessor: undefined },
      ]);
      const [url, init] = fetchStub.mock.calls[0] as unknown as [URL, RequestInit];
      expect(String(url)).toContain('/v1/sys/internal/ui/mounts');
      expect((init.headers as Record<string, string>)['X-Vault-Token']).toBeUndefined();
    } finally {
      setBaoConfig({ token: 'test-token' });
    }
  });
});

describe('response wrapping / one-time share links', () => {
  it('builds and parses fragment-based share links without leaking the token to the path', () => {
    const token = 'hvs.CAESIJ-example.wrapping.token';
    const link = shareLinkFor(token, 'http://127.0.0.1:5173');
    expect(link).toBe(`http://127.0.0.1:5173/unwrap#wrap=${encodeURIComponent(token)}`);
    expect(link).not.toContain('?');
    expect(wrappingTokenFromHash(`#wrap=${encodeURIComponent(token)}`)).toBe(token);
    expect(wrappingTokenFromHash('#wrap=' + token + '&x=1')).toBe(token);
    expect(wrappingTokenFromHash('')).toBeNull();
    expect(wrappingTokenFromHash('#other=abc')).toBeNull();
  });

  it('accepts only safe Go durations for wrap TTL', () => {
    expect(validWrapTtl('5m')).toBe(true);
    expect(validWrapTtl('90s')).toBe(true);
    expect(validWrapTtl('24h')).toBe(true);
    expect(validWrapTtl('30 days')).toBe(false);
    expect(validWrapTtl('')).toBe(false);
  });

  it('wraps with X-Vault-Wrap-TTL and unwraps using the wrapping token', async () => {
    setBaoConfig({ token: 'test-token' });
    const fetchStub = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: async () => JSON.stringify({ wrap_info: { token: 'hvs.wrap', ttl: 300 } }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: async () => JSON.stringify({ data: { source: 'a/b', data: { KEY: 'value' } } }),
      } as unknown as Response);

    const wrapped = await bao.wrapResponse({ source: 'a/b', data: {} }, '5m');
    expect(wrapped.wrap_info.token).toBe('hvs.wrap');
    const [wrapUrl, wrapInit] = fetchStub.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(wrapUrl)).toContain('/v1/sys/wrapping/wrap');
    expect((wrapInit.headers as Record<string, string>)['X-Vault-Wrap-TTL']).toBe('5m');

    const unwrapped = await bao.unwrapResponse('hvs.wrap');
    expect((unwrapped.data as { source: string }).source).toBe('a/b');
    const [unwrapUrl, unwrapInit] = fetchStub.mock.calls[1] as unknown as [URL, RequestInit];
    expect(String(unwrapUrl)).toContain('/v1/sys/wrapping/unwrap');
    // The wrapping token, not the session token, authenticates the unwrap.
    expect((unwrapInit.headers as Record<string, string>)['X-Vault-Token']).toBe('hvs.wrap');
  });
});

describe('runbook paths', () => {
  it('builds runbook API and metadata paths with the kv mount prefix', () => {
    expect(runbookApiPath('securus')).toBe('kv/data/_runbooks/securus');
    expect(runbookMetadataPath('securus')).toBe('kv/metadata/_runbooks/securus');
  });

  it('gates runbook reads and metadata with capability paths', () => {
    const paths = runbookCapabilityPaths(['a', 'b']);
    expect(paths).toContain('kv/metadata/_runbooks/');
    expect(paths).toContain('kv/data/_runbooks/a');
    expect(paths).toContain('kv/metadata/_runbooks/a');
    expect(paths).toContain('kv/data/_runbooks/b');
    expect(paths).toContain('kv/metadata/_runbooks/b');
    // Never gate capability checks on the legacy guess for another layout.
    expect(paths.every((path) => path.startsWith('kv/'))).toBe(true);
  });
});

describe('layout-derived policy helpers', () => {
  const profile: LayoutProfile = {
    kind: 'project-repo-env',
    envIndex: 2,
    componentIndex: 1,
    metadataKeys: { project: 'project', env: 'env', component: 'component' },
    description: 'project / repo / <environment>',
  };
  const legacy: LayoutProfile = {
    kind: 'legacy-env',
    envIndex: 1,
    componentIndex: -1,
    metadataKeys: { project: 'project', env: 'env', component: 'component' },
    description: 'project / env / <environment>',
  };
  const classified: ClassifiedSecret[] = [
    { physical: 'securus/backend/development/database/postgres', project: 'securus', env: 'development', logical: 'database/postgres', component: 'backend', source: 'heuristic' },
    { physical: 'securus/backend/development/app/config', project: 'securus', env: 'development', logical: 'app/config', component: 'backend', source: 'heuristic' },
    { physical: 'securus/backend/production/database/postgres', project: 'securus', env: 'production', logical: 'database/postgres', component: 'backend', source: 'heuristic' },
  ];

  it('chooses the environment-list prefix from the profile', () => {
    expect(envListMetadataPath(legacy, 'ui-demo')).toBe('kv/metadata/ui-demo/env/');
    expect(envListMetadataPath(profile, 'securus')).toBe('kv/metadata/securus/');
  });

  it('collects only the parents of secrets in the selected environment', () => {
    const parents = discoveredParents('securus', 'development', classified);
    expect(parents).toContain('securus/backend/development/database');
    expect(parents).toContain('securus/backend/development/app');
    expect(parents.some((parent) => parent.includes('production'))).toBe(false);
    expect(discoveredParents('empty-project', '*', [])).toEqual(['empty-project']);
  });

  it('builds viewer rules from discovered paths without write capabilities', () => {
    const rules = templateRulesFromLayout('viewer', 'securus', 'development', profile, classified);
    const dataPaths = rules.filter((rule) => rule.path.startsWith('kv/data/securus/backend/development/'));
    expect(dataPaths.length).toBeGreaterThan(0);
    expect(dataPaths.every((rule) => rule.path.endsWith('/*'))).toBe(true);
    expect(dataPaths.every((rule) => rule.capabilities.includes('read'))).toBe(true);
    expect(rules.some((rule) => rule.capabilities.includes('create'))).toBe(false);
    expect(rules.some((rule) => rule.capabilities.includes('delete'))).toBe(false);
    expect(rules.some((rule) => rule.path === 'kv/metadata/securus/')).toBe(true);
  });

  it('grants writes and TOTP access to the admin template', () => {
    const rules = templateRulesFromLayout('admin', 'securus', 'development', profile, classified);
    const dataPaths = rules.filter((rule) => rule.path.startsWith('kv/data/securus/backend/development/'));
    expect(dataPaths.every((rule) => ['create', 'read', 'update', 'delete'].every((cap) => rule.capabilities.includes(cap)))).toBe(true);
    expect(rules.some((rule) => rule.path === 'totp/code/securus--*')).toBe(true);
    expect(rules.some((rule) => rule.path === 'totp/keys/securus--*')).toBe(true);
    // Trailing wildcard only; no mid-path globs that this build treats literally.
    expect(rules.every((rule) => !/\*[^*]*\//.test(rule.path))).toBe(true);
  });

  it('offers simulator presets taken from real paths in one environment', () => {
    const presets = simulatorPathsFromLayout(profile, 'securus', 'development', classified);
    expect(presets).toContain('kv/data/securus/backend/development/database/postgres');
    expect(presets).toContain('kv/data/securus/backend/development/app/config');
    expect(presets.some((path) => path.includes('production'))).toBe(false);
    expect(presets).toContain('kv/metadata/securus/');
    expect(presets).toContain('kv/data/securus/creds/example-console');
    expect(new Set(presets).size).toBe(presets.length);
  });

  it('filters and infers policy names that mention the project', () => {
    const policies = ['default', 'securus-viewer', 'securus-developer', 'securus-admin', 'other-readonly'];
    expect(projectPolicyNames('securus', policies)).toEqual(['securus-viewer', 'securus-developer', 'securus-admin']);
    expect(projectPolicyNames('SECURUS', policies)).toHaveLength(3);
    const names = inferRolePolicyNames('securus', 'development', policies);
    expect(names.viewer).toBe('securus-viewer');
    expect(names.developer).toBe('securus-developer');
    expect(names.admin).toBe('securus-admin');
    // No env-specific name exists, so it falls back to a role match for any env.
    expect(inferRolePolicyNames('securus', 'production', policies).viewer).toBe('securus-viewer');
  });
});

describe('secrets presentation', () => {
  it('groups field names by prefix and folds singletons into Other', () => {
    const groups = groupFieldsByPrefix({
      AWS_ACCESS_KEY_ID: 'a',
      AWS_SECRET_ACCESS_KEY: 'b',
      JWT_SECRET: 'c',
      JWT_EXPIRY: 'd',
      DATABASE_URL: 'e',
      username: 'f',
    });
    expect(groups.map((group) => group.label)).toEqual(['AWS', 'JWT', 'Other']);
    expect(groups[0].fields.map(([name]) => name)).toEqual(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']);
    expect(groups[2].fields.map(([name]) => name)).toEqual(['DATABASE_URL', 'username']);
    // No field is lost: every input name appears exactly once across groups.
    expect(groups.flatMap((group) => group.fields.map(([name]) => name)).sort()).toEqual([
      'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_URL', 'JWT_EXPIRY', 'JWT_SECRET', 'username',
    ]);
  });

  it('does not create a group for a lone prefixed field', () => {
    const groups = groupFieldsByPrefix({ AWS_KEY: 'a', OTHER: 'b' });
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Other');
    expect(groups[0].fields).toHaveLength(2);
  });

  it('keeps the selected environment visible when tabs overflow', () => {
    const envs = ['development', 'staging', 'production', 'qa', 'preview', 'local'];
    expect(environmentTabs(envs, 'production')).toEqual({
      tabs: ['production', 'development', 'staging', 'qa'],
      more: ['preview', 'local'],
    });
    expect(environmentTabs(envs, undefined, 2).tabs).toEqual(['development', 'staging']);
    expect(environmentTabs(['only'])).toEqual({ tabs: ['only'], more: [] });
  });
});

describe('secret lifecycle', () => {
  const versions = {
    '1': { created_time: '2026-01-01T00:00:00Z', deletion_time: '2026-01-03T00:00:00Z' },
    '2': { created_time: '2026-01-02T00:00:00Z', destroyed: true },
    '3': { created_time: '2026-01-03T00:00:00Z' },
  };

  it('classifies version state with destroyed taking priority over deleted', () => {
    expect(versionState(3, versions['3'], 3)).toBe('current');
    expect(versionState(2, versions['2'], 3)).toBe('destroyed');
    expect(versionState(1, versions['1'], 3)).toBe('deleted');
    expect(versionState(1, { created_time: 'x' }, 3)).toBe('older');
  });

  it('lists only recoverable deleted versions, newest first', () => {
    expect(deletedVersions(versions)).toEqual([{
      version: 1,
      deletedAt: '2026-01-03T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
    }]);
    expect(deletedVersions({})).toEqual([]);
  });

  it('validates delete_version_after durations and defaults settings', () => {
    expect(durationError('')).toBeNull();
    expect(durationError('0s')).toBeNull();
    expect(durationError('30d')).toBeNull();
    expect(durationError('1h30m')).toBeNull();
    expect(durationError('2h45m10s')).toBeNull();
    expect(durationError('30 days')).toContain('Use a duration');
    expect(durationError('forever')).toContain('Use a duration');
    expect(durationError('1h30')).toContain('Use a duration');
    expect(versionSettingsFrom({})).toEqual({ maxVersions: 0, casRequired: false, deleteVersionAfter: '0s' });
    expect(versionSettingsFrom({ max_versions: 5, cas_required: true, delete_version_after: '7d' })).toEqual({
      maxVersions: 5, casRequired: true, deleteVersionAfter: '7d',
    });
  });

  it('allows lifecycle actions through either update or create capability', () => {
    const map = { 'kv/undelete/a': ['create'], 'kv/destroy/a': ['deny'] };
    expect(canAny(map, 'kv/undelete/a', ['update', 'create'])).toBe(true);
    expect(canAny(map, 'kv/destroy/a', ['update', 'create'])).toBe(false);
    expect(canAny(undefined, 'kv/undelete/a', ['update'])).toBe(false);
  });
});

describe('KV mount picker protocol (v1/v2)', () => {
  it('discovers KV mounts from sys/internal/ui/mounts and ignores non-KV engines', () => {
    expect(kvMountsFromMap({
      'kv/': { type: 'kv', options: { version: '2' }, description: 'default' },
      'legacy/': { type: 'kv', options: { version: '1' } },
      'pki/': { type: 'pki', options: { version: '' } },
    })).toEqual([
      { path: 'kv', version: 2, description: 'default' },
      { path: 'legacy', version: 1, description: undefined },
    ]);
  });

  it('builds version-aware list/data paths', () => {
    const v2: KvMountInfo = { path: 'kv', version: 2 };
    const v1: KvMountInfo = { path: 'legacy', version: 1 };
    expect(kvListPath(v2, '')).toBe('kv/metadata/');
    expect(kvListPath(v2, 'app/prod')).toBe('kv/metadata/app/prod/');
    expect(kvDataPath(v2, 'app/prod')).toBe('kv/data/app/prod');
    expect(kvListPath(v1, '')).toBe('legacy/');
    expect(kvListPath(v1, 'app')).toBe('legacy/app/');
    expect(kvDataPath(v1, 'app')).toBe('legacy/app');
    expect(kvSupportsVersions(v2)).toBe(true);
    expect(kvSupportsVersions(v1)).toBe(false);
    expect(kvDataField(v2)).toBe('data.data');
    expect(kvDataField(v1)).toBe('data');
  });

  it('probes capabilities for a selected mount and folder', () => {
    const v1: KvMountInfo = { path: 'legacy', version: 1 };
    expect(kvBrowserCapabilityPaths()).toEqual(['sys/internal/ui/mounts']);
    expect(kvBrowserCapabilityPaths(v1, 'app')).toEqual(['legacy/app/', 'legacy/__new__']);
  });

  it('generates mount-aware snippets without embedding secret values', () => {
    const v1: KvMountInfo = { path: 'legacy', version: 1 };
    expect(baoCliSnippet('app', v1)).toBe('bao kv get -mount=legacy -format=json app');
    expect(curlSnippet('app', v1)).toContain('/v1/legacy/app');
    expect(curlSnippet('app', v1)).toContain("'.data'");
    expect(envPullSnippet('app', v1)).toContain("-mount=legacy");
    expect(envPullSnippet('app', v1)).toContain(".data |");
    // Defaults preserved for existing v2 callers.
    expect(baoCliSnippet('roomsss/env/development/app')).toBe('bao kv get -mount=kv -format=json roomsss/env/development/app');
  });
});
