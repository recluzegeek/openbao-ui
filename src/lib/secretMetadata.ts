/** UI annotations stored as KV v2 custom_metadata. Values are never part of the secret payload. */
export interface SecretAnnotations {
  tags: string[];
  note: string;
  /** field name -> comment */
  comments: Record<string, string>;
  /** identity -> (field name -> personal override value) */
  overrides: Record<string, Record<string, string>>;
}

const EMPTY: SecretAnnotations = { tags: [], note: '', comments: {}, overrides: {} };

function objectOfStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, child === null || child === undefined ? '' : String(child)]),
  );
}

function parseJson(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function parseAnnotations(custom?: Record<string, string>): SecretAnnotations {
  if (!custom) return { ...EMPTY };
  const tags = parseJson(custom.ui_tags);
  const comments = parseJson(custom.ui_comments);
  const overrides = parseJson(custom.ui_overrides);
  const parsedOverrides: Record<string, Record<string, string>> = {};
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    for (const [identity, fields] of Object.entries(overrides)) {
      parsedOverrides[identity] = objectOfStrings(fields);
    }
  }
  return {
    tags: Array.isArray(tags) ? tags.map(String).filter(Boolean) : [],
    note: custom.ui_note ?? '',
    comments: objectOfStrings(comments),
    overrides: parsedOverrides,
  };
}

/** Keep unknown custom_metadata keys intact when writing UI annotations back. */
export function mergeAnnotations(
  base: Record<string, string> | undefined,
  annotations: SecretAnnotations,
): Record<string, string> {
  return {
    ...(base ?? {}),
    ui_tags: JSON.stringify(annotations.tags),
    ui_note: annotations.note,
    ui_comments: JSON.stringify(annotations.comments),
    ui_overrides: JSON.stringify(annotations.overrides),
  };
}

export function overridesFor(annotations: SecretAnnotations, identity: string): Record<string, string> {
  return annotations.overrides[identity] ?? {};
}

export function withOverridesFor(
  annotations: SecretAnnotations,
  identity: string,
  fields: Record<string, string>,
): SecretAnnotations {
  const overrides = { ...annotations.overrides };
  if (Object.keys(fields).length === 0) delete overrides[identity];
  else overrides[identity] = fields;
  return { ...annotations, overrides };
}

/** Personal overrides win in the UI, but the stored KV value is never changed. */
export function effectiveValue(key: string, stored: unknown, overrides: Record<string, string>): string {
  const value = stored === null || stored === undefined ? '' : String(stored);
  return Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : value;
}
