import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState } from '@/components/common/Extras';
import { LoginPage } from '@/features/auth/LoginPage';
import { SecretsPage } from '@/features/secrets/SecretsPage';
import { CodesPage } from '@/features/totp/CodesPage';
import { AutomationPage } from '@/features/automation/AutomationPage';
import { RunbooksPage } from '@/features/runbooks/RunbooksPage';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => <div className="page"><EmptyState title="Page not found">Use the sidebar to get back to your secrets.</EmptyState></div>,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
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
  validateSearch: (search: Record<string, unknown>) => ({
    project: typeof search.project === 'string' ? search.project : undefined,
    env: typeof search.env === 'string' ? search.env : undefined,
    service: typeof search.service === 'string' ? search.service : undefined,
  }),
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

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([indexRoute, secretsRoute, codesRoute, automationRoute, runbooksRoute]),
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
