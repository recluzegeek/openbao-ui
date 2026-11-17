import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, BookOpen, Compass, KeyRound, Keyboard, LogOut, Moon, Search, Server, Shield, ShieldCheck, Sun, TerminalSquare } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/useTheme';
import { tokenTtlLabel } from '@/lib/format';
import { CommandPalette } from './CommandPalette';
import { ShortcutsDialog } from './ShortcutsDialog';

const links = [
  { to: '/welcome' as const, label: 'Getting started', icon: Compass },
  { to: '/secrets' as const, label: 'Secrets', icon: KeyRound },
  { to: '/search' as const, label: 'Search', icon: Search },
  { to: '/runbooks' as const, label: 'Runbooks', icon: BookOpen },
  { to: '/codes' as const, label: 'One-time codes', icon: ShieldCheck },
  { to: '/access' as const, label: 'Access control', icon: Shield },
  { to: '/audit' as const, label: 'Audit log', icon: Activity },
  { to: '/automation' as const, label: 'For agents', icon: TerminalSquare },
];

export function AppShell() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    if (auth.status === 'anonymous') void navigate({ to: '/login', replace: true });
  }, [auth.status, navigate]);

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

  if (auth.status !== 'authenticated') {
    return (
      <div className="state" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
        <p>Opening your OpenBao session…</p>
      </div>
    );
  }

  const displayName = auth.identity?.display_name || auth.identity?.name || 'Signed in';
  const policies = auth.identity?.policies ?? [];
  const ttlLabel = tokenTtlLabel(policies, auth.identity?.ttl, auth.identity?.expire_time);

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
          {links.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className={`nav-link ${pathname === to ? 'active' : ''}`} aria-current={pathname === to ? 'page' : undefined}>
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
              <div className="identity-chip__sub">
                {policies.length ? `${policies.length} polic${policies.length === 1 ? 'y' : 'ies'} · ${ttlLabel}` : 'token session'}
              </div>
            </div>
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
            <label className="small muted" htmlFor="namespace">Namespace</label>
            <input
              id="namespace"
              aria-label="OpenBao namespace"
              placeholder="root"
              value={auth.namespace}
              onChange={(event) => {
                auth.setNamespace(event.target.value);
                void queryClient.clear();
              }}
              style={{ width: 130, padding: '0.4rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', background: 'var(--color-background)', color: 'var(--color-text-primary)' }}
            />
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
