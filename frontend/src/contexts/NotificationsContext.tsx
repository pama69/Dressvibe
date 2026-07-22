/**
 * Polls /api/info-requests/unread-count every ~60s while the user is logged in.
 * Exposes the current count + a short "ding" sound when the count increases
 * (i.e. a new customer request has arrived while the app was open).
 *
 * When the user has enabled push notifications (toggle in Profilo), a growth
 * in the unread count also presents a local on-device notification — so the
 * banner appears even when the app is in background or on another screen.
 * Requests are persisted on the backend so nothing is ever lost: when the
 * user reopens the app they see the full backlog.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import { useAuth } from "@/src/contexts/AuthContext";
import { api } from "@/src/api/client";
import { isPushEnabled, presentLocalNotification, enableRemotePush } from "@/src/lib/push";

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

const POLL_MS = 60000;

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

  // Fire the on-device push notification (if the user enabled it) alongside
  // the ding. `delta` = how many new requests arrived since last check.
  const notifyGrowth = useCallback(async (delta: number) => {
    playDing();
    try {
      if (!(await isPushEnabled())) return;
      const body =
        delta <= 1
          ? "Hai una nuova richiesta info da un cliente 👗"
          : `Hai ${delta} nuove richieste info dai clienti 👗`;
      await presentLocalNotification("Nuova richiesta cliente", body);
    } catch {
      // push is best-effort — never block the badge update
    }
  }, [playDing]);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const r = await api.infoRequestsUnreadCount();
      const next = r.count || 0;
      const prev = prevUnreadRef.current;
      // prev === -1 is the sentinel for the very first fetch → never notify.
      if (prev >= 0 && next > prev) {
        notifyGrowth(next - prev);
      }
      prevUnreadRef.current = next;
      setUnread(next);
    } catch {
      // network errors are fine — try again on next tick
    }
  }, [user, notifyGrowth]);

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
    // Re-sync the remote push token if the user has push enabled — tokens can
    // rotate across reinstalls/updates, so we refresh the backend binding on
    // every login. Best-effort: no-op on web / Expo Go / when disabled.
    (async () => {
      try {
        if (await isPushEnabled()) await enableRemotePush();
      } catch {}
    })();

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
