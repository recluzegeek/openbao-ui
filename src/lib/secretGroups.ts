/** Field groups shown in the masked secret detail pane. */

export interface FieldGroup {
  /** Stable identifier, e.g. `AWS_` or `__other`. */
  id: string;
  /** Human label, e.g. `AWS` or `Other`. */
  label: string;
  fields: Array<[name: string, value: unknown]>;
}

/**
 * Group environment-style field names by the prefix before the first underscore.
 * Prefixes with a single field are folded into "Other" so a 77-row secret
 * collapses into a handful of expandable groups instead of 77 rows.
 */
export function groupFieldsByPrefix(data: Record<string, unknown>): FieldGroup[] {
  const buckets = new Map<string, Array<[string, unknown]>>();
  for (const [name, value] of Object.entries(data)) {
    const separator = name.indexOf('_');
    const prefix = separator > 0 ? name.slice(0, separator + 1) : '';
    if (!buckets.has(prefix)) buckets.set(prefix, []);
    buckets.get(prefix)!.push([name, value]);
  }

  const groups: FieldGroup[] = [];
  for (const [id, fields] of buckets) {
    if (fields.length < 2 || !id) continue;
    groups.push({ id, label: id.replace(/_$/, ''), fields });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label));

  const singles: Array<[string, unknown]> = [];
  for (const [id, fields] of buckets) {
    if (fields.length >= 2 && id) continue;
    singles.push(...fields);
  }
  if (singles.length) groups.push({ id: '__other', label: 'Other', fields: singles });
  return groups;
}

/** Environment tabs: keep the selected one visible, cap the rest, overflow into a combobox. */
export function environmentTabs(envs: string[], selected?: string, max = 4): { tabs: string[]; more: string[] } {
  const ordered = [...envs];
  if (selected && ordered.includes(selected)) {
    ordered.splice(ordered.indexOf(selected), 1);
    ordered.unshift(selected);
  }
  return { tabs: ordered.slice(0, max), more: ordered.slice(max) };
}
