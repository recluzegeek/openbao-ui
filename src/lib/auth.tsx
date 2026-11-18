import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  bao,
  BaoError,
  clearBaoSession,
  getBaoConfig,
  setBaoConfig,
  type LookupSelfResponse,
} from './api';

type Status = 'loading' | 'authenticated' | 'anonymous';
type Identity = LookupSelfResponse['data'];

interface AuthContextValue {
  status: Status;
  identity: Identity | null;
  /** True when policies came from resultant-acl, including group policies. */
  effectivePolicies: boolean;
  address: string;
  namespace: string;
  error: string | null;
  loginWithToken: (token: string, address?: string, namespace?: string) => Promise<void>;
  loginWithUserpass: (username: string, password: string, address?: string, namespace?: string, mount?: string) => Promise<void>;
  setAddress: (address: string) => void;
  setNamespace: (namespace: string) => void;
  /** Extend the current token lease and refresh its expiry. */
  renew: (increment?: string | number) => Promise<void>;
  /** Re-read lookup-self and resultant-acl without changing the session. */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function messageOf(error: unknown): string {
  if (error instanceof BaoError) return error.message;
  return error instanceof Error ? error.message : 'Sign-in failed';
}

function isRejected(error: unknown): boolean {
  return error instanceof BaoError && (error.status === 401 || error.status === 403);
}

/** `lookup-self` misses group policies, so merge in resultant-acl when allowed. */
export function mergeEffectivePolicies(tokenPolicies: string[], effective?: string[]) {
  if (!effective?.length) return { policies: tokenPolicies, effective: false };
  return { policies: [...new Set([...tokenPolicies, ...effective])], effective: true };
}

/** `lookup-self` splits direct token policies from identity-group policies. */
export function mergeLookupPolicies(policies?: string[], identityPolicies?: string[]): string[] {
  return [...new Set([...(policies ?? []), ...(identityPolicies ?? [])])];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const initial = getBaoConfig();
  const [status, setStatus] = useState<Status>(initial.token ? 'loading' : 'anonymous');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [effectivePolicies, setEffectivePolicies] = useState(false);
  const [address, setAddressState] = useState(initial.address);
  const [namespace, setNamespaceState] = useState(initial.namespace);
  const [error, setError] = useState<string | null>(null);

  const refreshIdentity = useCallback(async (
    options: { preserveOnError?: boolean } = {},
  ): Promise<{ ok: boolean; error?: unknown }> => {
    try {
      const result = await bao.lookupSelf();
      // `lookup-self` splits token policies from identity-group policies. Merge
      // both so an org-admin token no longer reports only "default".
      const identityPolicies = result.data.identity_policies ?? [];
      let policies = mergeLookupPolicies(result.data.policies, identityPolicies);
      let fromAcl = identityPolicies.length > 0;
      try {
        // Group policies are only visible through this endpoint. A 403 here
        // must not invalidate an otherwise healthy token.
        const acl = await bao.resultantAcl();
        const merged = mergeEffectivePolicies(policies, acl.data.policies);
        policies = merged.policies;
        fromAcl = fromAcl || merged.effective;
      } catch {
        // Fall back to the token's directly attached policies.
      }
      setIdentity({ ...result.data, policies });
      setEffectivePolicies(fromAcl);
      setStatus('authenticated');
      setError(null);
      return { ok: true };
    } catch (error) {
      if (isRejected(error)) {
        clearBaoSession();
        setIdentity(null);
        setEffectivePolicies(false);
        setStatus('anonymous');
        setError(messageOf(error));
      } else {
        // Network errors, 404s and 5xx must not silently log the user out.
        if (!options.preserveOnError || !getBaoConfig().token) {
          clearBaoSession();
          setIdentity(null);
          setStatus('anonymous');
        }
        setError(`Session check failed: ${messageOf(error)}.`);
      }
      return { ok: false, error };
    }
  }, []);

  useEffect(() => {
    if (getBaoConfig().token) void refreshIdentity({ preserveOnError: true });
  }, [refreshIdentity]);

  const setAddress = useCallback((value: string) => {
    const normalized = value.replace(/\/$/, '');
    setAddressState(normalized);
    setBaoConfig({ address: normalized });
  }, []);

  const setNamespace = useCallback((value: string) => {
    setNamespaceState(value);
    setBaoConfig({ namespace: value });
    void queryClient.clear();
  }, [queryClient]);

  const loginWithToken = useCallback(
    async (token: string, nextAddress?: string, nextNamespace?: string) => {
      setError(null);
      if (nextAddress) setAddress(nextAddress);
      if (nextNamespace !== undefined) setNamespace(nextNamespace);
      setBaoConfig({ token: token.trim() });
      const result = await refreshIdentity();
      if (!result.ok) throw result.error instanceof Error ? result.error : new Error('OpenBao did not accept that token.');
    },
    [refreshIdentity, setAddress, setNamespace],
  );

  const loginWithUserpass = useCallback(
    async (username: string, password: string, nextAddress?: string, nextNamespace?: string, mount?: string) => {
      setError(null);
      if (nextAddress) setAddress(nextAddress);
      if (nextNamespace !== undefined) setNamespace(nextNamespace);
      const result = await bao.loginUserpass(username, password, mount);
      setBaoConfig({ token: result.auth.client_token });
      const identityResult = await refreshIdentity();
      if (!identityResult.ok) {
        throw identityResult.error instanceof Error
          ? identityResult.error
          : new Error('OpenBao did not accept that session.');
      }
    },
    [refreshIdentity, setAddress, setNamespace],
  );

  const renew = useCallback(async (increment?: string | number) => {
    const result = await bao.renewSelf(increment);
    // The renewal response carries the new ttl/expire_time. Merge it into the
    // identity so the countdown updates immediately, then verify the full
    // identity in the background without ever logging the token value.
    setIdentity((current) => current ? { ...current, ...result.data } : current);
    await refreshIdentity({ preserveOnError: true });
  }, [refreshIdentity]);

  const refresh = useCallback(async () => {
    await refreshIdentity({ preserveOnError: true });
  }, [refreshIdentity]);

  const logout = useCallback(async () => {
    try {
      await bao.logout();
    } catch {
      // Revocation is best-effort; always clear the local session.
    }
    clearBaoSession();
    queryClient.clear();
    setIdentity(null);
    setEffectivePolicies(false);
    setStatus('anonymous');
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      identity,
      effectivePolicies,
      address,
      namespace,
      error,
      loginWithToken,
      loginWithUserpass,
      setAddress,
      setNamespace,
      renew,
      refresh,
      logout,
    }),
    [status, identity, effectivePolicies, address, namespace, error, loginWithToken, loginWithUserpass, setAddress, setNamespace, renew, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
