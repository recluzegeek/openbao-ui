export interface AuditEntry {
  time: string;
  operation?: string;
  path?: string;
  displayName?: string;
  policies?: string[];
  allowed?: boolean;
}

export interface AuditResponse {
  available: boolean;
  entries: AuditEntry[];
}

const OPERATION_LABELS: Record<string, string> = {
  create: 'created',
  update: 'changed',
  read: 'read',
  delete: 'deleted',
  list: 'listed',
  sudo: 'administered',
};

export function operationLabel(operation?: string): string {
  return operation ? (OPERATION_LABELS[operation] ?? operation) : 'requested';
}

export function actorLabel(entry: AuditEntry): string {
  if (entry.displayName) return entry.displayName;
  if (entry.policies?.length) return `token (${entry.policies.join(', ')})`;
  return 'unknown token';
}
