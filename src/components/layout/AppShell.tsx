import { useEffect, useState, type FormEvent } from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Activity, BookOpen, Compass, KeyRound, Keyboard, LogOut, Moon, RefreshCw, Search, Server, Shield, ShieldCheck, Sun, TerminalSquare, Trash2 } from 'lucide-react';
import { bao, normalizeNamespace } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSetupStage } from '@/lib/queries';
import { useTheme } from '@/lib/useTheme';
import { formatTtl, tokenTtlLabel } from '@/lib/format';
import { useSessionCountdown } from '@/lib/session';
import { CommandPalette } from './CommandPalette';
import { ShortcutsDialog } from './ShortcutsDialog';

const links = [
  { to: '/welcome' as const, label: 'Getting started', icon: Compass },
  { to: '/secrets' as const, label: 'Secrets', icon: KeyRound },
  { to: '/trash' as const, label: 'Trash', icon: Trash2 },
  { to: '/search' as const, label: 'Search', icon: Search },
  { to: '/runbooks' as const, label: 'Runbooks', icon: BookOpen },
  { to: '/codes' as const, label: 'One-time codes', icon: ShieldCheck },
  { to: '/access' as const, label: 'Access control', icon: Shield },
  { to: '/audit' as const, label: 'Audit log', icon: Activity },
  { to: '/automation' as const, label: 'For agents', icon: TerminalSquare },
];

export function AppShell() {
  const auditConfigured = import.meta.env.DEV || Boolean(import.meta.env.VITE_AUDIT_ENDPOINT);
  const stage = useSetupStage();
  const visibleLinks = links.filter((link) =>
    (link.to !== '/audit' || auditConfigured)
    && (link.to !== '/welcome' || stage !== 'ready'));
  const auth = useAuth();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [namespaceDraft, setNamespaceDraft] = useState(auth.namespace);
  const [namespaceError, setNamespaceError] = useState<string | null>(null);

  const namespacesQ = useQuery({
    queryKey: ['namespaces', auth.address],
    queryFn: () => bao.listNamespaces(),
    enabled: auth.status === 'authenticated',
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    setNamespaceDraft(auth.namespace);
    setNamespaceError(null);
  }, [auth.namespace]);

  useEffect(() => {
    if (auth.status === 'anonymous') void navigate({ to: '/login', replace: true });
  }, [auth.status, navigate]);

  function applyNamespace(event?: FormEvent) {
    event?.preventDefault();
    try {
      const next = normalizeNamespace(namespaceDraft);
      setNamespaceError(null);
      setNamespaceDraft(next);
      if (next !== auth.namespace) auth.setNamespace(next);
    } catch (error) {
      setNamespaceError(error instanceof Error ? error.message : 'Invalid namespace');
    }
  }

  // Global keyboard shortcuts. Typing in a field takes priority so secret values
  // are never intercepted, and ⌘K stays owned by the command palette.
  useEffect(() => {
    const jump: Array<() => void> = [
      () => void navigate({ to: '/welcome' }),
      () => void navigate({ to: '/secrets', search: { project: undefined, env: undefined, service: undefined, folder: undefined } }),
      () => void navigate({ to: '/search', search: { q: undefined } }),
      () => void navigate({ to: '/runbooks', search: { project: undefined } }),
      () => void navigate({ to: '/codes' }),
      () => void navigate({ to: '/access', search: { view: undefined, project: undefined, env: undefined } }),
      () => void navigate({ to: '/audit', search: { q: undefined, actor: undefined, operation: undefined, range: undefined } }),
      () => void navigate({ to: '/automation', search: { path: undefined } }),
    ];
    const handler = (event: KeyboardEvent) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && /^[1-8]$/.test(event.key)) {
        event.preventDefault();
        jump[Number(event.key) - 1]();
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
      ));
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
      } else if (event.key === '/') {
        event.preventDefault();
        window.dispatchEvent(new Event('console:open-palette'));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  const remaining = useSessionCountdown(auth.identity?.expire_time, auth.identity?.ttl);
  const [renewing, setRenewing] = useState(false);
  const displayName = auth.identity?.display_name || auth.identity?.name || 'Signed in';
  const policies = auth.identity?.policies ?? [];
  const ttlLabel = tokenTtlLabel(policies, auth.identity?.ttl, auth.identity?.expire_time);
  const renewable = Boolean(auth.identity?.renewable && remaining !== null);

  if (auth.status !== 'authenticated') {
    return (
      <div className="state" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
        <p>Opening your OpenBao session…</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <div className="brand__mark" aria-hidden="true">B</div>
          <div>
            <span className="brand__name">OpenBao</span>
            <span className="brand__tag">community console</span>
          </div>
        </div>

        <nav className="nav-group" aria-label="Workspace">
          <div className="nav-group__label">Workspace</div>
          {visibleLinks.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} data-testid={`nav-${to.slice(1)}`} className={`nav-link ${pathname === to ? 'active' : ''}`} aria-current={pathname === to ? 'page' : undefined}>
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="notice small">
            <Server size={14} /> <span className="mono">{auth.address}</span>
          </div>
          <div className="identity-chip">
            <div className="identity-chip__avatar" aria-hidden="true">
              {(displayName[0] ?? 'U').toUpperCase()}
            </div>
            <div className="identity-chip__meta">
              <div className="identity-chip__name" title={displayName}>{displayName}</div>
              <div className="identity-chip__sub" title={auth.effectivePolicies ? 'Includes group policies from resultant-acl' : 'Direct token policies; group policies are unavailable for this token'}>
                {policies.length ? `${policies.length} polic${policies.length === 1 ? 'y' : 'ies'}${auth.effectivePolicies ? ' · effective' : ''} · ${ttlLabel}` : 'token session'}
                {remaining !== null && <span className={`session-countdown ${remaining < 300 ? 'session-countdown--urgent' : ''}`} data-testid="session-countdown"> · {formatTtl(remaining)} left</span>}
              </div>
            </div>
            {renewable && (
              <button
                className="icon-btn"
                title="Renew session token"
                aria-label="Renew session token"
                data-testid="renew-token"
                disabled={renewing}
                onClick={async () => {
                  setRenewing(true);
                  try { await auth.renew(); } finally { setRenewing(false); }
                }}
              >
                <RefreshCw size={16} className={renewing ? 'spin' : ''} />
              </button>
            )}
            <button className="icon-btn" title="Sign out" aria-label="Sign out" onClick={() => void auth.logout()}>
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__title">
            <h1>{links.find((link) => link.to === pathname)?.label ?? 'Secrets'}</h1>
            <p>Manage secrets, codes and machine access in one place</p>
          </div>
          <div className="topbar__actions">
            <button
              className="btn btn--outlined btn--small topbar__search"
              onClick={() => window.dispatchEvent(new Event('console:open-palette'))}
              aria-label="Open command palette"
              title="Open command palette (⌘K / Ctrl+K)"
            >
              <Search size={15} /> <span>Search</span> <kbd>⌘K</kbd>
            </button>
            <button
              className="icon-btn"
              onClick={() => setShortcutsOpen(true)}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              data-testid="shortcuts-open"
            >
              <Keyboard size={17} />
            </button>
            <form className="namespace-control" onSubmit={applyNamespace} title={namespaceError ?? 'Namespace changes are applied only when you click Apply'}>
              <label className="small muted" htmlFor="namespace">Namespace</label>
              <input
                id="namespace"
                aria-label="OpenBao namespace"
                aria-invalid={Boolean(namespaceError)}
                data-testid="namespace-input"
                list="namespace-options"
                placeholder="root"
                value={namespaceDraft}
                onChange={(event) => setNamespaceDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') applyNamespace(); }}
              />
              <datalist id="namespace-options">
                {(namespacesQ.data ?? []).map((name) => <option key={name} value={name} />)}
              </datalist>
              <button type="submit" className="btn btn--ghost btn--small" data-testid="namespace-apply" disabled={namespaceDraft === auth.namespace}>
                Apply
              </button>
            </form>
            {namespaceError && <span className="small" role="alert" style={{ color: 'var(--color-red)' }}>{namespaceError}</span>}
            <button className="icon-btn" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme">
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>
        <main className="page" id="main-content" tabIndex={-1}><Outlet /></main>
      </div>
      <CommandPalette />
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
