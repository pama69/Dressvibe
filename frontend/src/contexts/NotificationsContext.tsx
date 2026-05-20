/**
 * Polls /api/info-requests/unread-count every ~25s while the user is logged in.
 * Exposes the current count + a short "ding" sound when the count increases
 * (i.e. a new customer request has arrived while the app was open).
 *
 * Phase 1 only — no native push yet. Requests are persisted on the backend
 * so nothing is ever lost: when the user reopens the app they see the full
 * backlog.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import { useAuth } from "@/src/contexts/AuthContext";
import { api } from "@/src/api/client";

type NotificationsCtx = {
  unread: number;
  refresh: () => Promise<void>;
  markAllRead: () => Promise<void>;
};

const Ctx = createContext<NotificationsCtx>({
  unread: 0,
  refresh: async () => {},
  markAllRead: async () => {},
});

const POLL_MS = 25000;

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const prevUnreadRef = useRef(0);
  const timerRef = useRef<any>(null);
  const appStateRef = useRef<AppStateStatus>("active");

  const playDing = useCallback(async () => {
    try {
      if (Platform.OS === "web") {
        // Web Audio API: generate a short pleasant "ding" without any asset.
        const AC = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const now = ctx.currentTime;
        // Two-tone notification chime (E5 → C6)
        [659.25, 1046.5].forEach((freq, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "sine";
          o.frequency.value = freq;
          o.connect(g); g.connect(ctx.destination);
          const start = now + i * 0.14;
          g.gain.setValueAtTime(0.0001, start);
          g.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
          o.start(start);
          o.stop(start + 0.55);
        });
        setTimeout(() => { try { ctx.close(); } catch {} }, 1200);
        return;
      }
      // Native: gentle haptic feedback (reliable on iOS+Android, no asset required)
      const Haptics: any = await import("expo-haptics").catch(() => null);
      if (Haptics?.notificationAsync) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      // Silent fail — sound/haptic is "nice-to-have"
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const r = await api.infoRequestsUnreadCount();
      const next = r.count || 0;
      if (next > prevUnreadRef.current && prevUnreadRef.current >= 0) {
        // Only ding when we actually grew (not at first load)
        if (prevUnreadRef.current > 0 || next > 0 ? prevUnreadRef.current !== 0 : false) {
          // Already had >0 and got more → ding
          playDing();
        }
        // Also ding on first transition from 0 → N≥1 while app open
        if (prevUnreadRef.current === 0 && next > 0) {
          playDing();
        }
      }
      prevUnreadRef.current = next;
      setUnread(next);
    } catch {
      // network errors are fine — try again on next tick
    }
  }, [user, playDing]);

  const markAllRead = useCallback(async () => {
    try {
      await api.markAllInfoRequestsRead();
    } catch {}
    prevUnreadRef.current = 0;
    setUnread(0);
  }, []);

  // Start polling when user logged in
  useEffect(() => {
    if (!user) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      prevUnreadRef.current = 0;
      setUnread(0);
      return;
    }
    // Initial fetch (no ding because prev=0 and we set guard below)
    prevUnreadRef.current = -1; // sentinel: skip ding on the very first fetch
    refresh().then(() => {
      // After first fetch, set prev to current so next growth dings normally.
      prevUnreadRef.current = Math.max(0, prevUnreadRef.current);
    });
    timerRef.current = setInterval(() => {
      if (appStateRef.current === "active") refresh();
    }, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [user, refresh]);

  // Refresh whenever app comes back to foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev !== "active" && next === "active") {
        refresh();
      }
    });
    return () => sub.remove();
  }, [refresh]);

  const value = useMemo(() => ({ unread, refresh, markAllRead }), [unread, refresh, markAllRead]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications() {
  return useContext(Ctx);
}
