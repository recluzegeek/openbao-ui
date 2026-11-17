export type ImportFormat = 'env' | 'json' | 'yaml' | 'tsv';

export interface ParseResult {
  data: Record<string, string>;
  error?: string;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function flatten(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (value === null || value === undefined) return out;
  if (typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof child === 'object' && child !== null) flatten(child, path, out);
      else out[path] = String(child);
    }
  } else {
    out[prefix] = String(value);
  }
  return out;
}

export function parseKeyValueText(text: string, format: ImportFormat): ParseResult {
  try {
    if (format === 'json') {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { data: {}, error: 'JSON must be an object of key/value pairs.' };
      }
      return { data: flatten(parsed) };
    }

    const data: Record<string, string> = {};
    if (format === 'yaml' || format === 'env') {
      const lines = text.split(/\r?\n/);
      let blockKey: string | null = null;
      let blockIndent: number | undefined;
      const block: string[] = [];
      const flush = () => {
        if (blockKey !== null) {
          data[blockKey] = block.join('\n');
          blockKey = null;
          blockIndent = undefined;
          block.length = 0;
        }
      };
      for (const raw of lines) {
        const line = raw.replace(/\s+$/, '');
        if (!line.trim() || /^\s*#/.test(line)) { flush(); continue; }
        if (blockKey !== null) {
          const indent = raw.match(/^\s*/)?.[0].length ?? 0;
          if (indent > 0) {
            if (blockIndent === undefined) blockIndent = indent;
            block.push(raw.slice(blockIndent));
            continue;
          }
          flush();
        }
        const withoutExport = format === 'env' ? line.replace(/^\s*export\s+/, '') : line;
        const match = withoutExport.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*(?:=|:)\s*(.*)$/);
        if (!match) return { data: {}, error: `Cannot parse line: ${line.slice(0, 60)}` };
        const [, key, rawValue] = match;
        const value = rawValue.trim();
        if ((format === 'yaml' && (value === '|' || value === '>')) || value === '') {
          flush();
          blockKey = key;
        } else {
          data[key] = format === 'yaml' ? stripQuotes(value.replace(/\s+#.*$/, '')) : stripQuotes(value);
        }
      }
      flush();
      return { data };
    }

    // TSV / pasted spreadsheet rows: key<TAB>value (commas accepted as a fallback).
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const separator = line.includes('\t') ? '\t' : ',';
      const at = line.indexOf(separator);
      if (at === -1) return { data: {}, error: `Cannot parse row: ${line.slice(0, 60)}` };
      const key = line.slice(0, at).trim();
      if (!key) return { data: {}, error: 'Every row needs a name.' };
      data[key] = stripQuotes(line.slice(at + separator.length));
    }
    return { data };
  } catch (error) {
    return { data: {}, error: error instanceof Error ? error.message : 'Could not parse input.' };
  }
}

export function serializeKeyValue(data: Record<string, unknown>, format: ImportFormat): string {
  const entries = Object.entries(data).map(([key, value]) => [key, value === null || value === undefined ? '' : String(value)] as const);
  if (format === 'json') return JSON.stringify(Object.fromEntries(entries), null, 2);
  if (format === 'yaml') {
    return entries.map(([key, value]) => {
      if (value.includes('\n')) {
        const indented = value.split('\n').map((line) => `  ${line}`).join('\n');
        return `${key}: |\n${indented}`;
      }
      return `${key}: ${JSON.stringify(value)}`;
    }).join('\n');
  }
  if (format === 'tsv') return entries.map(([key, value]) => `${key}\t${value.replace(/\n/g, '\\n')}`).join('\n');
  return entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n');
}

const REFERENCE = /\$\{([^}]+)\}/g;

export function findReferences(value: string): string[] {
  return [...value.matchAll(REFERENCE)].map((match) => match[1].trim());
}

/** Resolve ${path.FIELD} references against a map of "path.FIELD" -> value. */
export function resolveReferences(value: string, lookup: Record<string, string>): string {
  return value.replace(REFERENCE, (whole, key: string) => {
    const resolved = lookup[key.trim()];
    return resolved === undefined ? whole : resolved;
  });
}

export function buildReferenceLookup(secrets: Array<{ path: string; data: Record<string, unknown> }>): Record<string, string> {
  const lookup: Record<string, string> = {};
  for (const secret of secrets) {
    for (const [key, value] of Object.entries(secret.data)) {
      lookup[`${secret.path}.${key}`] = value === null || value === undefined ? '' : String(value);
    }
  }
  return lookup;
}
