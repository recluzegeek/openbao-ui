import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState } from '@/components/common/Extras';
import { LoginPage } from '@/features/auth/LoginPage';
import { SecretsPage } from '@/features/secrets/SecretsPage';
import { TrashPage } from '@/features/secrets/TrashPage';
import { UnwrapPage } from '@/features/secrets/UnwrapPage';
import { CodesPage } from '@/features/totp/CodesPage';
import { AutomationPage } from '@/features/automation/AutomationPage';
import { RunbooksPage } from '@/features/runbooks/RunbooksPage';

import { AccessPage } from '@/features/access/AccessPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { WelcomePage } from '@/features/onboarding/WelcomePage';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => <div className="page"><EmptyState title="Page not found">Use the sidebar to get back to your secrets.</EmptyState></div>,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const unwrapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/unwrap',
  component: UnwrapPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_app',
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: SecretsPage,
});

const secretsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/secrets',
  component: SecretsPage,
  validateSearch: (search: Record<string, unknown>): {
    project?: string;
    env?: string;
    service?: string;
    folder?: string;
    /** A palette field match opens the secret with this key selected. */
    field?: string;
    /** A palette command pre-fills the create editor with this name. */
    create?: string;
  } => ({
    project: typeof search.project === 'string' ? search.project : undefined,
    env: typeof search.env === 'string' ? search.env : undefined,
    service: typeof search.service === 'string' ? search.service : undefined,
    folder: typeof search.folder === 'string' ? search.folder : undefined,
    field: typeof search.field === 'string' ? search.field : undefined,
    create: typeof search.create === 'string' ? search.create : undefined,
  }),
});

const trashRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/trash',
  component: TrashPage,
  validateSearch: (search: Record<string, unknown>) => ({
    project: typeof search.project === 'string' ? search.project : undefined,
  }),
});

// Kept as a redirect so old bookmarks land on the one search surface: the
// command palette is reachable from the topbar and never needs a page route.
const searchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/search',
  beforeLoad: () => { throw redirect({ to: '/secrets', search: {} }); },
});

const codesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/codes',
  component: CodesPage,
});

const automationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/automation',
  component: AutomationPage,
  validateSearch: (search: Record<string, unknown>) => ({
    path: typeof search.path === 'string' ? search.path : undefined,
  }),
});

const runbooksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/runbooks',
  component: RunbooksPage,
  validateSearch: (search: Record<string, unknown>) => ({
    project: typeof search.project === 'string' ? search.project : undefined,
  }),
});

const welcomeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/welcome',
  component: WelcomePage,
});

const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/audit',
  component: AuditPage,
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    actor: typeof search.actor === 'string' ? search.actor : undefined,
    operation: typeof search.operation === 'string' ? search.operation : undefined,
    range: typeof search.range === 'string' ? search.range : undefined,
  }),
});

const accessRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/access',
  component: AccessPage,
  validateSearch: (search: Record<string, unknown>) => ({
    view: typeof search.view === 'string' ? search.view : undefined,
    project: typeof search.project === 'string' ? search.project : undefined,
    env: typeof search.env === 'string' ? search.env : undefined,
  }),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  unwrapRoute,
  appRoute.addChildren([indexRoute, secretsRoute, trashRoute, searchRoute, codesRoute, automationRoute, runbooksRoute, accessRoute, auditRoute, welcomeRoute]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
