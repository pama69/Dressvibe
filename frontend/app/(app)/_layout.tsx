import React, { useEffect } from "react";
import { Tabs, Redirect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/contexts/AuthContext";
import { useNotifications } from "@/src/contexts/NotificationsContext";
import { theme, MAGIC_GRADIENT } from "@/src/theme";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Alert,
} from "react-native";
import { api } from "@/src/api/client";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

// Tab icon factory (module-level — prevents component remount on each render).
const tabIcon = (name: keyof typeof Ionicons.glyphMap) =>
  function TabIcon({ color }: { color: string }) {
    return <Ionicons name={name} size={20} color={color} />;
  };

/**
 * Global floating notification bell.
 * Lives ABOVE the Tabs so it is reachable on every screen in the (app)
 * group (Galleria, Genera, Storia, Profilo and any pushed sub-routes like
 * /garment/[id], /studio/[id], /results/[id], /upload, …).
 */
function GlobalNotifBell() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { unread } = useNotifications();
  const top = Math.max(insets.top, 0) + 10;

  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { zIndex: 50 }]}
    >
      <TouchableOpacity
        onPress={() => router.push("/notifications")}
        testID="global-bell-btn"
        activeOpacity={0.7}
        style={[bellStyles.btn, { top, right: 16 }]}
        hitSlop={6}
      >
        <Text style={bellStyles.emoji}>🔔</Text>
        {unread > 0 ? (
          <View style={bellStyles.badge}>
            <Text style={bellStyles.badgeText}>
              {unread > 99 ? "99+" : String(unread)}
            </Text>
          </View>
        ) : null}
      </TouchableOpacity>
    </View>
  );
}

const TABS = [
  { name: "index",    label: "Galleria", icon: "grid-outline"     as const },
  { name: "generate", label: "Genera",   icon: "sparkles-outline" as const },
  { name: "history",  label: "Storia",   icon: "time-outline"     as const },
  { name: "profile",  label: "Profilo",  icon: "person-outline"   as const },
];

function CustomTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const visibleRoutes = state.routes.filter((_: any, i: number) =>
    TABS.some((t) => t.name === state.routes[i].name)
  );

  return (
    <View style={[tb.wrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={tb.bar}>
        {TABS.map((tab) => {
          const routeIndex = state.routes.findIndex((r: any) => r.name === tab.name);
          const active = state.index === routeIndex;
          return (
            <Pressable
              key={tab.name}
              onPress={() => navigation.navigate(tab.name)}
              style={tb.pill}
              android_ripple={null}
            >
              {active ? (
                <View style={tb.pillActive}>
                  <LinearGradient
                    colors={MAGIC_GRADIENT}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={tb.pillActiveInner}>
                    <Ionicons name={tab.icon} size={18} color="#14060B" />
                    <Text style={tb.labelActive}>{tab.label}</Text>
                  </View>
                </View>
              ) : (
                <View style={tb.pillInactive}>
                  <Ionicons name={tab.icon} size={18} color={theme.colors.textMuted} />
                  <Text style={tb.labelInactive}>{tab.label}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function AppTabs() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await api.archiveCleanup();
        if (res.deleted > 0) {
          Alert.alert(
            "Archivio aggiornato",
            `Sono stati cancellati dall'archivio tutti i capi e le generazioni più vecchi di ${res.months} ${res.months === 1 ? "mese" : "mesi"}.`
          );
        }
      } catch {}
    })();
  }, [user?.user_id]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={theme.colors.text} />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Tabs
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: "Galleria", tabBarIcon: tabIcon("grid-outline") }}
        />
        <Tabs.Screen
          name="generate"
          options={{ title: "Genera", tabBarIcon: tabIcon("sparkles-outline") }}
        />
        <Tabs.Screen
          name="history"
          options={{ title: "Storia", tabBarIcon: tabIcon("time-outline") }}
        />
        <Tabs.Screen
          name="profile"
          options={{ title: "Profilo", tabBarIcon: tabIcon("person-outline") }}
        />
        {/* Hidden routes — accessible via push but not shown in tab bar */}
        <Tabs.Screen name="upload" options={{ href: null }} />
        <Tabs.Screen name="backgrounds" options={{ href: null }} />
        <Tabs.Screen name="generating" options={{ href: null }} />
        <Tabs.Screen name="results/[id]" options={{ href: null }} />
        <Tabs.Screen name="studio/[id]" options={{ href: null }} />
        <Tabs.Screen name="garment/[id]" options={{ href: null }} />
        <Tabs.Screen name="model-picker" options={{ href: null }} />
        <Tabs.Screen name="notifications" options={{ href: null }} />
      </Tabs>
      {/* Global bell overlay — always on top, reachable from every screen */}
      <GlobalNotifBell />
    </View>
  );
}

const tb = StyleSheet.create({
  wrap: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: "transparent",
  },
  bar: {
    flexDirection: "row",
    borderRadius: 24,
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "#101016",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  pill: { flex: 1 },
  pillActive: {
    borderRadius: 16,
    overflow: "hidden",
  },
  pillActiveInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  pillInactive: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 9,
    paddingHorizontal: 6,
    gap: 2,
  },
  labelActive: {
    color: "#14060B",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  labelInactive: {
    color: theme.colors.textMuted,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 1,
  },
});

const bellStyles = StyleSheet.create({
  btn: {
    position: "absolute",
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(16,16,22,0.82)",
  },
  emoji: { fontSize: 19, lineHeight: 23 },
  badge: {
    position: "absolute",
    top: 1,
    right: 1,
    minWidth: 17,
    height: 17,
    borderRadius: 8.5,
    backgroundColor: theme.colors.error,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: theme.colors.bg,
  },
  badgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
