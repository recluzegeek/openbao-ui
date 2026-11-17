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

export function validateRows(rows: FieldRow[]): string | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) return 'Every field needs a name.';
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
