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
  address: string;
  namespace: string;
  error: string | null;
  loginWithToken: (token: string, address?: string, namespace?: string) => Promise<void>;
  loginWithUserpass: (username: string, password: string, address?: string, namespace?: string) => Promise<void>;
  setAddress: (address: string) => void;
  setNamespace: (namespace: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function messageOf(error: unknown): string {
  if (error instanceof BaoError) return error.message;
  return error instanceof Error ? error.message : 'Sign-in failed';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const initial = getBaoConfig();
  const [status, setStatus] = useState<Status>(initial.token ? 'loading' : 'anonymous');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [address, setAddressState] = useState(initial.address);
  const [namespace, setNamespaceState] = useState(initial.namespace);
  const [error, setError] = useState<string | null>(null);

  const refreshIdentity = useCallback(async (): Promise<boolean> => {
    try {
      const result = await bao.lookupSelf();
      setIdentity(result.data);
      setStatus('authenticated');
      setError(null);
      return true;
    } catch (error) {
      clearBaoSession();
      setIdentity(null);
      setStatus('anonymous');
      setError(messageOf(error));
      return false;
    }
  }, []);

  useEffect(() => {
    if (getBaoConfig().token) void refreshIdentity();
  }, [refreshIdentity]);

  const setAddress = useCallback((value: string) => {
    const normalized = value.replace(/\/$/, '');
    setAddressState(normalized);
    setBaoConfig({ address: normalized });
  }, []);

  const setNamespace = useCallback((value: string) => {
    setNamespaceState(value);
    setBaoConfig({ namespace: value });
  }, []);

  const loginWithToken = useCallback(
    async (token: string, nextAddress?: string, nextNamespace?: string) => {
      setError(null);
      if (nextAddress) setAddress(nextAddress);
      if (nextNamespace !== undefined) setNamespace(nextNamespace);
      setBaoConfig({ token: token.trim() });
      if (!(await refreshIdentity())) {
        throw new Error('OpenBao did not accept that token.');
      }
    },
    [refreshIdentity, setAddress, setNamespace],
  );

  const loginWithUserpass = useCallback(
    async (username: string, password: string, nextAddress?: string, nextNamespace?: string) => {
      setError(null);
      if (nextAddress) setAddress(nextAddress);
      if (nextNamespace !== undefined) setNamespace(nextNamespace);
      try {
        const result = await bao.loginUserpass(username, password);
        setBaoConfig({ token: result.auth.client_token });
        await refreshIdentity();
      } catch (error) {
        setError(messageOf(error));
        throw error;
      }
    },
    [refreshIdentity, setAddress, setNamespace],
  );

  const logout = useCallback(async () => {
    try {
      await bao.logout();
    } catch {
      // Revocation is best-effort; always clear the local session.
    }
    clearBaoSession();
    queryClient.clear();
    setIdentity(null);
    setStatus('anonymous');
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      identity,
      address,
      namespace,
      error,
      loginWithToken,
      loginWithUserpass,
      setAddress,
      setNamespace,
      logout,
    }),
    [status, identity, address, namespace, error, loginWithToken, loginWithUserpass, setAddress, setNamespace, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
