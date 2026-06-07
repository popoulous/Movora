import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { api, type AuthStatus, type User } from "./api";

interface AuthValue {
  loading: boolean;
  authenticated: boolean;
  needsSetup: boolean;
  user: User | null;
  setUser: (user: User) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    api
      .authStatus()
      .then(setStatus)
      .catch(() => setStatus({ authenticated: false, needs_setup: false, user: null }));
    // A cookie expiring mid-session drops us back to the login gate.
    const onExpired = (): void =>
      setStatus((prev) => (prev ? { ...prev, authenticated: false, user: null } : prev));
    window.addEventListener("movora:unauthorized", onExpired);
    return () => window.removeEventListener("movora:unauthorized", onExpired);
  }, []);

  const setUser = useCallback((user: User) => {
    setStatus({ authenticated: true, needs_setup: false, user });
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setStatus({ authenticated: false, needs_setup: false, user: null });
  }, []);

  const value: AuthValue = {
    loading: status === null,
    authenticated: status?.authenticated ?? false,
    needsSetup: status?.needs_setup ?? false,
    user: status?.user ?? null,
    setUser,
    logout,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
