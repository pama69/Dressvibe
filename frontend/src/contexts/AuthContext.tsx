import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
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
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

function parseSessionId(url: string): string | null {
  try {
    const hashIdx = url.indexOf("#");
    if (hashIdx >= 0) {
      const params = new URLSearchParams(url.substring(hashIdx + 1));
      const sid = params.get("session_id");
      if (sid) return sid;
    }
    const qIdx = url.indexOf("?");
    if (qIdx >= 0) {
      const params = new URLSearchParams(url.substring(qIdx + 1));
      const sid = params.get("session_id");
      if (sid) return sid;
    }
  } catch {}
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const processSessionId = useCallback(async (sessionId: string) => {
    const res = await api.exchangeSession(sessionId);
    await setToken(res.session_token);
    setUser(res.user);
  }, []);

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

  // On mount: check URL for session_id (web cold path) + existing token
  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === "web" && typeof window !== "undefined") {
          const url = window.location.href;
          const sid = parseSessionId(url);
          if (sid) {
            await processSessionId(sid);
            // Clean URL
            window.history.replaceState(null, "", window.location.pathname);
            setLoading(false);
            return;
          }
        } else {
          const initial = await Linking.getInitialURL();
          if (initial) {
            const sid = parseSessionId(initial);
            if (sid) {
              await processSessionId(sid);
              setLoading(false);
              return;
            }
          }
        }
        await refresh();
      } catch (e) {
        console.warn("Auth init error", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [processSessionId, refresh]);

  // Hot deep link
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Linking.addEventListener("url", async ({ url }) => {
      const sid = parseSessionId(url);
      if (sid) {
        try {
          await processSessionId(sid);
        } catch (e) {
          console.warn("Hot link auth error", e);
        }
      }
    });
    return () => sub.remove();
  }, [processSessionId]);

  const signIn = useCallback(async () => {
    const redirectUrl =
      Platform.OS === "web"
        ? `${window.location.origin}/`
        : Linking.createURL("auth");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(
      redirectUrl
    )}`;
    if (Platform.OS === "web") {
      window.location.href = authUrl;
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    if (result.type === "success" && result.url) {
      const sid = parseSessionId(result.url);
      if (sid) await processSessionId(sid);
    }
  }, [processSessionId]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {}
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
