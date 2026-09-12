import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { onUnauthorized } from '../../lib/authEvents';
import { LoginPage } from './LoginPage';

export interface AuthUser {
  id: number;
  login: string;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'signedIn'; user: AuthUser }
  | { status: 'signedOut' }
  | { status: 'denied' }
  | { status: 'error'; detail?: string };

interface AuthContextValue {
  user: AuthUser;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthGate>');
  return value;
};

/** Renders children only for a signed-in, whitelisted user; otherwise the login page. */
export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>(() =>
    new URLSearchParams(window.location.search).get('auth') === 'denied' ? { status: 'denied' } : { status: 'loading' }
  );

  const checkSession = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (response.status === 401) setState({ status: 'signedOut' });
      else if (response.ok) setState({ status: 'signedIn', user: await response.json() });
      else {
        // A misconfigured server (503) names what is missing; show it instead of
        // a generic network message. The body never contains secret values.
        const detail = await response
          .json()
          .then((body) => (typeof body?.detail === 'string' ? body.detail : undefined))
          .catch(() => undefined);
        setState({ status: 'error', detail });
      }
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    if (state.status === 'denied') {
      // Drop ?auth=denied so a refresh offers a normal sign-in.
      const url = new URL(window.location.href);
      url.searchParams.delete('auth');
      window.history.replaceState(null, '', url);
      return;
    }
    void checkSession();
    // Only on mount; later checks are triggered explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => onUnauthorized(() => setState({ status: 'signedOut' })), []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    setState({ status: 'signedOut' });
  }, []);

  if (state.status === 'signedIn') {
    return <AuthContext.Provider value={{ user: state.user, logout }}>{children}</AuthContext.Provider>;
  }

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-stone">
        <Loader2 size={20} className="animate-spin text-moss" />
      </div>
    );
  }

  return (
    <LoginPage
      variant={state.status}
      detail={state.status === 'error' ? state.detail : undefined}
      onRetry={checkSession}
    />
  );
};
