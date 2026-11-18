import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, LockKeyhole, ShieldCheck, TerminalSquare } from 'lucide-react';
import { bao, normalizeNamespace } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { useToast } from '@/lib/toast';

type Method = 'token' | 'userpass' | 'oidc';

export function LoginPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const { addToast } = useToast();
  const [method, setMethod] = useState<Method>('userpass');
  const [address, setAddress] = useState(auth.address);
  const [namespace, setNamespace] = useState(auth.namespace);
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [unsealKey, setUnsealKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const health = useQuery({
    queryKey: ['login-health', address],
    queryFn: () => bao.health(),
    retry: false,
    staleTime: 10_000,
  });
  const seal = useQuery({
    queryKey: ['login-seal', address],
    queryFn: () => bao.sealStatus(),
    retry: false,
    staleTime: 5_000,
  });
  // sys/internal/ui/mounts is readable before sign-in, so the form can show
  // only the methods this server actually has instead of guessing.
  const authMethods = useQuery({
    queryKey: ['login-auth-methods', address],
    queryFn: () => bao.detectAuthMethods(),
    retry: false,
    staleTime: 60_000,
  });
  const detected = authMethods.data ?? [];
  const userpassMount = detected.find((item) => item.type === 'userpass')?.path;
  const oidcMount = detected.find((item) => item.type === 'oidc' || item.type === 'jwt')?.path;
  // Until detection settles (or if it is denied), keep username visible so
  // sign-in is never blocked by a best-effort probe.
  const userpassAvailable = !authMethods.isSuccess || Boolean(userpassMount);
  const oidcConfigured = Boolean(oidcMount);

  useEffect(() => {
    if (authMethods.isSuccess && !userpassMount && method === 'userpass') setMethod('token');
  }, [authMethods.isSuccess, userpassMount, method]);

  useEffect(() => {
    if (auth.status === 'authenticated') void navigate({ to: '/secrets', search: { project: undefined, env: undefined, service: undefined, folder: undefined }, replace: true });
  }, [auth.status, navigate]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    setBusy(true);
    try {
      const nextNamespace = normalizeNamespace(namespace);
      setNamespace(nextNamespace);
      if (method === 'token') await auth.loginWithToken(token, address, nextNamespace);
      else await auth.loginWithUserpass(username, password, address, nextNamespace, userpassMount);
      addToast('success', 'Signed in');
      await navigate({ to: '/secrets', search: { project: undefined, env: undefined, service: undefined, folder: undefined }, replace: true });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleUnseal(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      await bao.unseal(unsealKey);
      await seal.refetch();
      await health.refetch();
      setUnsealKey('');
      addToast('success', 'OpenBao is unsealed');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Unseal failed');
    } finally {
      setBusy(false);
    }
  }

  const errorMessage = localError ?? auth.error;
  const isSealed = seal.data?.sealed;

  return (
    <div className="login-page">
      <aside className="login-aside">
        <div>
          <div className="brand" style={{ color: 'white' }}>
            <div className="brand__mark" style={{ background: 'rgba(255,255,255,.18)' }}>B</div>
            <div>
              <span className="brand__name">OpenBao</span>
              <span className="brand__tag" style={{ color: 'rgba(255,255,255,.75)' }}>community console</span>
            </div>
          </div>
          <h1 style={{ marginTop: '4rem' }}>Secrets that feel obvious.</h1>
          <p style={{ marginTop: '1rem' }}>
            Browse development, staging and production side by side. Read one-time codes. Hand machines
            exact commands instead of screenshots.
          </p>
          <ul style={{ marginTop: '2rem' }}>
            <li>Environment-first secret browsing</li>
            <li>Shareable deep links with safe defaults</li>
            <li>Permissions visible before you click</li>
          </ul>
        </div>
        <p className="small">Prototype UI · not affiliated with the OpenBao project</p>
      </aside>

      <main className="login-main">
        <div className="login-card">
          <div>
            <h2>{isSealed ? 'Unseal OpenBao' : 'Sign in'}</h2>
            <p className="muted small">
              {isSealed
                ? 'This dev server is sealed. Provide one unseal key to continue.'
                : 'Your token stays in this browser tab and is never written to disk.'}
            </p>
          </div>

          {health.isError && (
            <div className="notice error">
              <AlertTriangle size={15} /> Cannot reach {address}. Start the local OpenBao container or check the address.
            </div>
          )}
          {errorMessage && <div className="notice error">{errorMessage}</div>}

          {isSealed ? (
            <form onSubmit={handleUnseal} className="grid" style={{ gap: '0.9rem' }}>
              <Input label="Unseal key" type="password" value={unsealKey} onChange={(e) => setUnsealKey(e.target.value)} required fullWidth />
              <Button type="submit" loading={busy} fullWidth>Unseal</Button>
            </form>
          ) : (
            <>
              <div className="login-card__methods" role="tablist" aria-label="Sign-in method">
                <Button
                  variant={method === 'userpass' ? 'primary' : 'outlined'}
                  onClick={() => setMethod('userpass')}
                  size="small" icon={<ShieldCheck size={15} />}
                  data-testid="login-method-userpass"
                  role="tab" aria-selected={method === 'userpass'}
                  disabled={!userpassAvailable}
                  title={userpassAvailable ? undefined : 'No userpass auth method is configured on this server'}
                >
                  Username
                </Button>
                <Button
                  variant={method === 'token' ? 'primary' : 'outlined'}
                  onClick={() => setMethod('token')}
                  size="small" icon={<KeyRound size={15} />}
                  data-testid="login-method-token"
                  role="tab" aria-selected={method === 'token'}
                >
                  Token
                </Button>
                <Button
                  variant={method === 'oidc' ? 'primary' : 'outlined'}
                  size="small" icon={<TerminalSquare size={15} />}
                  onClick={() => setMethod('oidc')}
                  data-testid="login-method-oidc"
                  role="tab" aria-selected={method === 'oidc'}
                  disabled={!oidcConfigured}
                  title={oidcConfigured ? 'OIDC is configured but not yet wired into this console' : 'No OIDC auth method is configured on this server'}
                >
                  OIDC
                </Button>
              </div>

              {authMethods.isSuccess && (
                <p className="small muted" data-testid="auth-methods-detected">
                  Auth methods on this server: {detected.length ? detected.map((item) => item.type).join(', ') : 'none detected'}
                </p>
              )}

              {method === 'oidc' ? (
                <div className="notice" data-testid="oidc-notice">
                  {oidcConfigured
                    ? 'An OIDC provider is configured on this server, but interactive OIDC sign-in is not wired into this console yet. Your team can keep using OIDC from the CLI in the meantime.'
                    : 'No OIDC auth method is configured on this server.'}
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="grid" style={{ gap: '0.9rem' }}>
                  <Input label="Server address" value={address} onChange={(e) => { setAddress(e.target.value); auth.setAddress(e.target.value); }} fullWidth data-testid="login-address" />
                  {method === 'token' ? (
                    <Input label="OpenBao token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required fullWidth data-testid="login-token" />
                  ) : (
                    <>
                      <Input label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required fullWidth data-testid="login-username" />
                      <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required fullWidth data-testid="login-password" />
                    </>
                  )}
                  <Input label="Namespace (optional)" value={namespace} onChange={(e) => setNamespace(e.target.value)} placeholder="e.g. team-a" fullWidth data-testid="login-namespace" />
                  <Button type="submit" loading={busy} fullWidth data-testid="login-submit">Sign in to console</Button>
                </form>
              )}
            </>
          )}

          <p className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <LockKeyhole size={14} /> Secrets are masked by default. Sign-in stays in this tab; theme, favorites and onboarding preferences are saved in this browser.
          </p>
        </div>
      </main>
    </div>
  );
}
