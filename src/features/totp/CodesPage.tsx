import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Lock, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { bao, type CapabilitiesMap } from '@/lib/api';
import { can, deniedReason } from '@/lib/capabilities';
import { parseTotpAccount, totpCodePath, totpKeyPath } from '@/lib/baoPaths';
import { parsePeriod, secondsUntil } from '@/lib/format';
import { totpCapabilityPaths, useCapabilities, useProjects, useTotpAccounts, useTotpCode, useTotpKey } from '@/lib/queries';
import { useToast } from '@/lib/toast';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { CopyButton, Dialog, EmptyState } from '@/components/common/Extras';

function CodeCard({ account, caps, onDelete }: { account: string; caps: CapabilitiesMap | undefined; onDelete: (account: string) => void }) {
  const code = useTotpCode(account);
  const key = useTotpKey(account);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const parsed = parseTotpAccount(account);
  const canReadCode = can(caps, totpCodePath(account), 'read');
  const canDelete = can(caps, totpKeyPath(account), 'delete');
  const period = parsePeriod(code.data?.data.period ?? key.data?.data.period ?? 30);
  const remaining = secondsUntil(code.data?.data.expire_time, now);
  const progress = period ? Math.min(100, (remaining / period) * 100) : 0;
  const expiring = remaining <= 5;

  return (
    <article className="panel code-card" data-testid={`code-${account}`}>
      <div className="code-card__top">
        <ShieldCheck size={18} style={{ color: 'var(--color-primary)', flex: 'none' }} />
        <div className="code-card__label">
          <h3 title={account}>{parsed.account}</h3>
          <div className="code-card__issuer">{key.data?.data.issuer || parsed.project} · {key.data?.data.account_name || 'shared account'}</div>
        </div>
        <Badge size="small" variant="outline">{parsed.project}</Badge>
      </div>

      {!canReadCode && caps ? (
        <div className="notice warning small" style={{ marginTop: '1rem' }}>
          <Lock size={14} /> {deniedReason(caps, totpCodePath(account), 'read')}
        </div>
      ) : (
        <>
          <div className={`code-card__code ${code.isLoading ? 'masked' : ''}`} data-testid={`code-value-${account}`}>
            {code.isLoading ? '••••••' : code.data?.data.code ?? '—— ——'}
          </div>
          <div className={`code-card__meter ${expiring ? 'expiring' : ''}`} aria-label={`${remaining} seconds remaining`}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="code-card__foot">
            <span>{remaining}s left</span>
            <span>·</span>
            <span>refreshes automatically</span>
            <div style={{ marginLeft: 'auto', display: 'flex' }}>
              <CopyButton
                value={code.data?.data.code ?? ''}
                label="Copy code"
              />
              <button
                className="icon-btn"
                title={canDelete ? 'Delete account' : deniedReason(caps, totpKeyPath(account), 'delete')}
                aria-label={`Delete ${account}`}
                disabled={!canDelete}
                onClick={() => onDelete(account)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          {code.isError && <p className="small" style={{ color: 'var(--color-red)', marginTop: '0.5rem' }}>{code.error instanceof Error ? code.error.message : 'Cannot read code'}</p>}
        </>
      )}
    </article>
  );
}

const SHORTCUTS_KEY = 'console.totp.shortcuts';

function loadShortcuts(): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(SHORTCUTS_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function CodesPage() {
  const accounts = useTotpAccounts();
  const projects = useProjects();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [shortcuts, setShortcuts] = useState<string[]>(loadShortcuts);
  const [shortcutInput, setShortcutInput] = useState('');
  const [filter, setFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [deleteAccount, setDeleteAccount] = useState<string | null>(null);
  const [prefix, setPrefix] = useState('');
  const [accountName, setAccountName] = useState('');
  const [issuer, setIssuer] = useState('');
  const [period, setPeriod] = useState('30');
  const [busy, setBusy] = useState(false);

  const fullName = prefix && accountName ? `${prefix}--${accountName}` : '';
  const allAccounts = useMemo(
    () => [...new Set([...(accounts.data ?? []), ...shortcuts])],
    [accounts.data, shortcuts],
  );
  // Include the path being typed in the Add dialog so root can create a brand-new
  // account; managers get `deny` and stay blocked.
  const capabilityPaths = useMemo(
    () => totpCapabilityPaths([...allAccounts, ...(fullName ? [fullName] : [])]),
    [allAccounts, fullName],
  );
  const capsQ = useCapabilities(capabilityPaths);
  const caps = capsQ.data;

  useEffect(() => {
    sessionStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts));
  }, [shortcuts]);

  useEffect(() => {
    if (!prefix && projects.data?.length) setPrefix(projects.data[0]);
  }, [projects.data, prefix]);

  function addShortcut() {
    const name = shortcutInput.trim();
    if (!name) return;
    setShortcuts((current) => (current.includes(name) ? current : [...current, name]));
    setShortcutInput('');
  }

  const visible = useMemo(() => {
    const needle = filter.toLowerCase();
    return allAccounts.filter((account) => {
      const parsed = parseTotpAccount(account);
      return [account, parsed.account, parsed.project, issuer].some((value) => value.toLowerCase().includes(needle));
    });
  }, [allAccounts, filter, issuer]);

  const grouped = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const account of visible) {
      const project = parseTotpAccount(account).project;
      groups.set(project, [...(groups.get(project) ?? []), account]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  const canCreate = fullName ? can(caps, totpKeyPath(fullName), 'create') || can(caps, totpKeyPath(fullName), 'update') : false;

  async function handleCreate() {
    if (!fullName) return;
    setBusy(true);
    try {
      await bao.createTotpKey(fullName, { issuer: issuer || 'OpenBao', accountName, period: Number(period) || 30 });
      await queryClient.invalidateQueries({ queryKey: ['totp-accounts'] });
      addToast('success', 'One-time code account created', 'The seed is stored in OpenBao and will never be shown again.');
      setShowAdd(false);
      setAccountName('');
      setIssuer('');
    } catch (error) {
      addToast('error', 'Could not create account', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteAccount) return;
    setBusy(true);
    try {
      await bao.deleteTotpKey(deleteAccount);
      await queryClient.invalidateQueries({ queryKey: ['totp-accounts'] });
      addToast('success', 'Account deleted', deleteAccount);
      setDeleteAccount(null);
    } catch (error) {
      addToast('error', 'Could not delete account', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gap: '1.1rem' }}>
      <div className="page__header">
        <div>
          <h2>One-time codes</h2>
          <p>Codes for shared accounts. Seeds stay inside OpenBao — nobody can read them back.</p>
        </div>
        <Button size="small" icon={<Plus size={15} />} onClick={() => setShowAdd(true)}>Add account</Button>
      </div>

      <div className="control-bar">
        <div className="search">
          <Search size={16} aria-hidden="true" />
          <input aria-label="Filter code accounts" placeholder="Filter by project or account…" value={filter} onChange={(event) => setFilter(event.target.value)} />
        </div>
        <div className="meta-row"><AlertTriangle size={15} /> Codes are sensitive — never paste them into chat or tickets.</div>
      </div>

      {accounts.isLoading && <div className="state"><div className="spinner" /></div>}

      {accounts.isError && (
        <div className="panel">
          <div className="panel__head">
            <Lock size={17} />
            <h3>Open a code by name</h3>
          </div>
          <div className="panel__body grid" style={{ gap: '0.8rem' }}>
            <div className="notice warning small">
              Your token can read individual one-time codes but cannot list every account
              ({accounts.error instanceof Error ? accounts.error.message : 'listing is not allowed'}).
              Enter the exact account name below — your admin can confirm it — to read its code.
            </div>
            <form
              onSubmit={(event) => { event.preventDefault(); addShortcut(); }}
              style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}
            >
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="account-shortcut">Account name</label>
                <input
                  id="account-shortcut"
                  className="mono"
                  placeholder="ui-demo--example-console"
                  value={shortcutInput}
                  onChange={(event) => setShortcutInput(event.target.value)}
                />
              </div>
              <Button type="submit" size="small" disabled={!shortcutInput.trim()}>Open code</Button>
            </form>
            {shortcuts.length > 0 && (
              <div className="grid" style={{ gap: '0.35rem' }}>
                <div className="section-title">Pinned in this tab</div>
                {shortcuts.map((name) => (
                  <div key={name} className="list-item" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
                    <span className="list-item__main mono small">{name}</span>
                    <button
                      className="icon-btn"
                      aria-label={`Forget ${name}`}
                      title="Forget this account"
                      onClick={() => setShortcuts((current) => current.filter((item) => item !== name))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="small muted">Account names are kept in this browser tab only. Codes are never stored.</p>
          </div>
        </div>
      )}

      {accounts.data?.length === 0 && allAccounts.length === 0 && (
        <EmptyState icon={<ShieldCheck size={28} />} title="No code accounts">
          An admin can add a shared account with a seed stored in OpenBao.
        </EmptyState>
      )}

      {grouped.map(([project, names]) => (
        <section key={project} className="grid" style={{ gap: '0.7rem' }}>
          <div className="section-title">{project} · {names.length}</div>
          <div className="code-grid">
            {names.map((account) => (
              <CodeCard key={account} account={account} caps={caps} onDelete={setDeleteAccount} />
            ))}
          </div>
        </section>
      ))}

      {showAdd && (
        <Dialog
          title="Add one-time code account"
          onClose={() => setShowAdd(false)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button loading={busy} disabled={!canCreate} onClick={() => void handleCreate()} title={fullName && !canCreate ? deniedReason(caps, totpKeyPath(fullName), 'create') : undefined}>
                Create account
              </Button>
            </>
          }
        >
          <div className="notice">
            OpenBao generates the seed and keeps it private. It will not be displayed here or on any later screen.
          </div>
          <div className="field">
            <label htmlFor="prefix">Project</label>
            <select id="prefix" value={prefix} onChange={(event) => setPrefix(event.target.value)}>
              {projects.data?.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <Input label="Account name" value={accountName} onChange={(event) => setAccountName(event.target.value.replace(/--/g, '-'))} placeholder="aws-console" hint={`Stored as ${fullName || 'project--account-name'}`} fullWidth />
          <Input label="Issuer" value={issuer} onChange={(event) => setIssuer(event.target.value)} placeholder="AWS" fullWidth />
          <div className="field">
            <label htmlFor="period">Period (seconds)</label>
            <select id="period" value={period} onChange={(event) => setPeriod(event.target.value)}>
              <option value="30">30</option>
              <option value="60">60</option>
            </select>
          </div>
          {fullName && !canCreate && <div className="notice warning small">{deniedReason(caps, totpKeyPath(fullName), 'create')}</div>}
        </Dialog>
      )}

      {deleteAccount && (
        <Dialog
          title="Delete code account?"
          onClose={() => setDeleteAccount(null)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setDeleteAccount(null)}>Cancel</Button>
              <Button variant="danger" loading={busy} onClick={() => void handleDelete()}>Delete permanently</Button>
            </>
          }
        >
          <p>Deleting <span className="mono">{deleteAccount}</span> stops all codes for that shared account. Everyone using it will lose access.</p>
          <div className="notice warning small">This cannot be undone. The seed is destroyed with the account.</div>
        </Dialog>
      )}
    </div>
  );
}
