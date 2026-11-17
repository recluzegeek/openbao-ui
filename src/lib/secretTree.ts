export interface SecretTreeFolder {
  /** Full path relative to the environment, e.g. "database/postgres". Empty for root. */
  path: string;
  name: string;
  folders: SecretTreeFolder[];
  secrets: string[];
}

function newFolder(path: string): SecretTreeFolder {
  return {
    path,
    name: path ? path.slice(path.lastIndexOf('/') + 1) : 'Root',
    folders: [],
    secrets: [],
  };
}

/** Turns flat KV paths (e.g. "database/postgres") into a folder tree. */
export function buildSecretTree(paths: string[]): SecretTreeFolder {
  const root = newFolder('');
  const folders = new Map<string, SecretTreeFolder>([['', root]]);

  function ensureFolder(path: string): SecretTreeFolder {
    const existing = folders.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf('/');
    const parent = ensureFolder(slash === -1 ? '' : path.slice(0, slash));
    const folder = newFolder(path);
    parent.folders.push(folder);
    folders.set(path, folder);
    return folder;
  }

  for (const raw of paths) {
    const path = raw.replace(/^\/+|\/+$/g, '');
    if (!path) continue;
    const slash = path.lastIndexOf('/');
    const parent = slash === -1 ? root : ensureFolder(path.slice(0, slash));
    if (!parent.secrets.includes(path)) parent.secrets.push(path);
  }

  const sort = (folder: SecretTreeFolder): void => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name));
    folder.secrets.sort((a, b) => a.localeCompare(b));
    folder.folders.forEach(sort);
  };
  sort(root);
  return root;
}

export function folderInTree(tree: SecretTreeFolder, path: string): SecretTreeFolder | undefined {
  if (tree.path === path) return tree;
  for (const child of tree.folders) {
    const found = folderInTree(child, path);
    if (found) return found;
  }
  return undefined;
}

export function secretName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function folderBreadcrumbs(folder: string): Array<{ label: string; path: string }> {
  if (!folder) return [{ label: 'Root', path: '' }];
  const parts = folder.split('/').filter(Boolean);
  return [
    { label: 'Root', path: '' },
    ...parts.map((part, index) => ({ label: part, path: parts.slice(0, index + 1).join('/') })),
  ];
}

/** Validate a secret path relative to its environment (folders separated by "/"). */
export function validSecretPath(path: string): boolean {
  const clean = path.trim().replace(/^\/+|\/+$/g, '');
  if (!clean) return false;
  if (clean !== path.trim()) return false;
  return clean.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..' && !part.includes('\\'));
}
