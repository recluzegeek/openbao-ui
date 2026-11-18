export interface FieldRow {
  id: string;
  key: string;
  value: string;
}

export function rowsFromData(data: Record<string, unknown>): FieldRow[] {
  return Object.entries(data).map(([key, value], index) => ({
    id: `row-${index}-${key}`,
    key,
    value: value === null || value === undefined ? '' : String(value),
  }));
}

export function dataFromRows(rows: FieldRow[]): Record<string, string> {
  const data: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) data[key] = row.value;
  }
  return data;
}

/** Count value-level field differences, including adds and removals. */
export function countFieldChanges(before: Record<string, string>, after: Record<string, string>): number {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let count = 0;
  for (const key of keys) if (before[key] !== after[key]) count++;
  return count;
}

/** Field names become KV data keys, so reject characters that break tooling and snippets. */
export function fieldNameError(key: string): string | null {
  const name = key.trim();
  if (!name) return 'Every field needs a name.';
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name)) {
    return 'Use letters, numbers, _, . or -; start with a letter, number or _.';
  }
  return null;
}

export function validateRows(rows: FieldRow[]): string | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    const invalid = fieldNameError(key);
    if (invalid) return invalid;
    if (seen.has(key)) return `Duplicate field name: ${key}`;
    seen.add(key);
  }
  return null;
}

/** Secret names are a single KV path segment below <project>/env/<env>/. */
export function validSecretName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !trimmed.includes('/') && trimmed !== '.' && trimmed !== '..';
}
