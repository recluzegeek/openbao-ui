import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, LockKeyhole, ShieldCheck, TerminalSquare } from 'lucide-react';
import { bao } from '@/lib/api';
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

  useEffect(() => {
    if (auth.status === 'authenticated') void navigate({ to: '/secrets', search: { project: undefined, env: undefined, service: undefined, folder: undefined }, replace: true });
  }, [auth.status, navigate]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    setBusy(true);
    try {
      if (method === 'token') await auth.loginWithToken(token, address, namespace);
      else await auth.loginWithUserpass(username, password, address, namespace);
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
                <Button variant={method === 'userpass' ? 'primary' : 'outlined'} onClick={() => setMethod('userpass')} size="small" icon={<ShieldCheck size={15} />}>
                  Username
                </Button>
                <Button variant={method === 'token' ? 'primary' : 'outlined'} onClick={() => setMethod('token')} size="small" icon={<KeyRound size={15} />}>
                  Token
                </Button>
                <Button variant="outlined" disabled size="small" icon={<TerminalSquare size={15} />} title="OIDC login is not wired up in this first slice">
                  OIDC
                </Button>
              </div>

              {method === 'oidc' ? (
                <div className="notice">
                  OIDC login needs a configured provider and callback handling. It is the next auth slice;
                  your team can keep using OIDC from the CLI in the meantime.
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="grid" style={{ gap: '0.9rem' }}>
                  <Input label="Server address" value={address} onChange={(e) => { setAddress(e.target.value); auth.setAddress(e.target.value); }} fullWidth />
                  <Input label="Namespace (optional)" value={namespace} onChange={(e) => setNamespace(e.target.value)} placeholder="e.g. team-a" fullWidth />
                  {method === 'token' ? (
                    <Input label="OpenBao token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required fullWidth />
                  ) : (
                    <>
                      <Input label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required fullWidth />
                      <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required fullWidth />
                    </>
                  )}
                  <Button type="submit" loading={busy} fullWidth>Sign in to console</Button>
                </form>
              )}
            </>
          )}

          <p className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <LockKeyhole size={14} /> Secrets are masked by default. Nothing is cached in local storage.
          </p>
        </div>
      </main>
    </div>
  );
}
