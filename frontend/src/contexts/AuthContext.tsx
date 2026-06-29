import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { api, setToken, clearToken, getToken } from "@/src/api/client";

export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  /** Used by the email/password flow: after a successful POST /api/auth/email/*
   *  the screen stores the returned session_token here and we hydrate user. */
  signInWithToken: (sessionToken: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const u = await api.me();
      setUser(u);
    } catch {
      await clearToken();
      setUser(null);
    }
  }, []);

  // On mount: hydrate from an existing session token, if any.
  useEffect(() => {
    (async () => {
      try {
        await refresh();
      } catch (e) {
        console.warn("Auth init error", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  const signInWithToken = useCallback(async (sessionToken: string, u: User) => {
    await setToken(sessionToken);
    setUser(u);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {}
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signInWithToken, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
