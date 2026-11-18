/**
 * Predicts what a full-data promote would do to a destination secret.
 *
 * Promotion writes the whole source field map, so a field that exists only at
 * the destination is *removed*, not merely left alone. This helper makes that
 * explicit so the UI can warn before a field such as DEBUG_EXTRA disappears.
 */

export interface PromotionPreview {
  /** Keys that would be created at the destination. */
  added: string[];
  /** Keys present in both, with a different value at the destination. */
  overwritten: string[];
  /** Keys present in both with the same value — no effective change. */
  unchanged: string[];
  /** Keys that exist only at the destination and would be deleted by the write. */
  removed: string[];
}

function has(data: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export function promotionPreview(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
): PromotionPreview {
  const added: string[] = [];
  const overwritten: string[] = [];
  const unchanged: string[] = [];
  const removed: string[] = [];

  for (const key of Object.keys(source).sort()) {
    if (!has(target, key)) added.push(key);
    else if (text(source[key]) === text(target[key])) unchanged.push(key);
    else overwritten.push(key);
  }
  for (const key of Object.keys(target).sort()) {
    if (!has(source, key)) removed.push(key);
  }

  return { added, overwritten, unchanged, removed };
}

/** Short, value-free summary used in dialog headings and toasts. */
export function promotionSummary(preview: PromotionPreview): string {
  const parts: string[] = [];
  if (preview.overwritten.length) parts.push(`${preview.overwritten.length} overwritten`);
  if (preview.added.length) parts.push(`${preview.added.length} added`);
  if (preview.removed.length) parts.push(`${preview.removed.length} removed`);
  if (!parts.length) parts.push(`${preview.unchanged.length} unchanged`);
  return parts.join(' · ');
}
