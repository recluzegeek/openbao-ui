import { describe, expect, it } from 'vitest';
import { can, deniedReason } from './capabilities';
import { envRank, parseTotpAccount, secretPath, totpCodePath } from './baoPaths';
import { envFile, parsePeriod, secondsUntil, shellQuote } from './format';
import { baoCliSnippet, curlSnippet } from './snippets';

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
});
