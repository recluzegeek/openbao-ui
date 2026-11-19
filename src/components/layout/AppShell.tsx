import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Activity, BookOpen, Compass, KeyRound, LogOut, Moon, RefreshCw, Search, Server, Shield, ShieldCheck, Sun, TerminalSquare, Trash2 } from 'lucide-react';
import { bao } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSetupStage } from '@/lib/queries';
import { useTheme } from '@/lib/useTheme';
import { formatTtl, tokenTtlLabel } from '@/lib/format';
import { useSessionCountdown } from '@/lib/session';
import { CommandPalette } from './CommandPalette';
import { ScopeSwitcher } from './ScopeSwitcher';
import { ShortcutsDialog } from './ShortcutsDialog';

const links = [
  { to: '/welcome' as const, label: 'Getting started', icon: Compass, hint: 'Set up this OpenBao server' },
  { to: '/secrets' as const, label: 'Secrets', icon: KeyRound, hint: 'Browse folders, environments and secret values' },
  { to: '/trash' as const, label: 'Trash', icon: Trash2, hint: 'Recover or permanently delete removed versions' },
  { to: '/runbooks' as const, label: 'Runbooks', icon: BookOpen, hint: 'Project notes and operational steps' },
  { to: '/codes' as const, label: 'One-time codes', icon: ShieldCheck, hint: 'Two-factor (TOTP) codes' },
  { to: '/access' as const, label: 'Access control', icon: Shield, hint: 'Teams, roles, policies and who can do what' },
  { to: '/audit' as const, label: 'Audit log', icon: Activity, hint: 'Who changed what, where and when' },
  { to: '/automation' as const, label: 'For agents', icon: TerminalSquare, hint: 'Command snippets and machine identities' },
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

  const healthQ = useQuery({
    queryKey: ['health', auth.address],
    queryFn: () => bao.health(),
    enabled: auth.status === 'authenticated',
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (auth.status === 'anonymous') void navigate({ to: '/login', replace: true });
  }, [auth.status, navigate]);

  // Global keyboard shortcuts. Typing in a field takes priority so secret values
  // are never intercepted, and ⌘K stays owned by the command palette.
  useEffect(() => {
    const jump: Array<() => void> = [
      () => void navigate({ to: '/welcome' }),
      () => void navigate({ to: '/secrets', search: { project: undefined, env: undefined, service: undefined, folder: undefined } }),
      () => void navigate({ to: '/runbooks', search: { project: undefined } }),
      () => void navigate({ to: '/codes' }),
      () => void navigate({ to: '/access', search: { view: undefined, project: undefined, env: undefined } }),
      () => void navigate({ to: '/audit', search: { q: undefined, actor: undefined, operation: undefined, range: undefined } }),
      () => void navigate({ to: '/automation', search: { path: undefined } }),
    ];
    const handler = (event: KeyboardEvent) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && /^[1-7]$/.test(event.key)) {
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
  // In dev the console talks to the same origin through a proxy, so the chip
  // must show the OpenBao target rather than 127.0.0.1:5173.
  const serverRaw = import.meta.env.DEV && typeof __BAO_TARGET__ === 'string' && __BAO_TARGET__
    ? __BAO_TARGET__
    : auth.address;
  const serverHost = (() => {
    try { return new URL(serverRaw).host; } catch { return serverRaw; }
  })();
  const health = healthQ.isError
    ? 'unreachable'
    : healthQ.data?.sealed
      ? 'sealed'
      : healthQ.data
        ? 'healthy'
        : 'checking';

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
        <Link to="/secrets" search={{ project: undefined, env: undefined, service: undefined, folder: undefined }} className="brand" aria-label="OpenBao console home">
          <div className="brand__mark" aria-hidden="true">B</div>
          <div>
            <span className="brand__name">OpenBao</span>
            <span className="brand__tag">community console</span>
          </div>
        </Link>

        <nav className="nav-group" aria-label="Workspace">
          <div className="nav-group__label">Workspace</div>
          {visibleLinks.map(({ to, label, icon: Icon, hint }) => (
            <Link key={to} to={to} title={hint} data-testid={`nav-${to.slice(1)}`} className={`nav-link ${pathname === to ? 'active' : ''}`} aria-current={pathname === to ? 'page' : undefined}>
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="server-chip" title={`${serverRaw} · ${health}`} aria-label={`OpenBao server ${serverHost} (${health})`} data-testid="server-chip">
            <span className={`server-chip__dot server-chip__dot--${health}`} aria-hidden="true" />
            <Server size={14} />
            <span className="server-chip__host mono">{serverHost}</span>
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
          {pathname === '/secrets' || pathname === '/' ? (
            <ScopeSwitcher />
          ) : (
            <div className="topbar__title">
              <h1>{links.find((link) => link.to === pathname)?.label ?? 'Secrets'}</h1>
            </div>
          )}
          <div className="topbar__actions">
            <button
              className="btn btn--outlined btn--small topbar__search"
              onClick={() => window.dispatchEvent(new Event('console:open-palette'))}
              aria-label="Open command palette"
              title="Open command palette (⌘K / Ctrl+K)"
            >
              <Search size={15} /> <span>Search</span> <kbd>⌘K</kbd>
            </button>
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
