import React, { useEffect } from "react";
import { Tabs, Redirect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/contexts/AuthContext";
import { useNotifications } from "@/src/contexts/NotificationsContext";
import { theme, MAGIC_GRADIENT, AURORA_ANGLE } from "@/src/theme";
import { GradientText, shadowAurora, shadowCard } from "@/src/components/noir";
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
import { BlurView } from "expo-blur";

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

// Dock order: Galleria · Storia · [FAB Genera] · Profilo.
// (The handoff's dock also shows a "Richieste" tab, but it isn't a built
// feature yet — no route exists for it — so the real dock keeps the 4
// tabs that already exist, with Genera promoted to the elevated FAB.)
const SIDE_TABS = [
  { name: "index",   label: "Galleria", icon: "grid-outline"   as const },
  { name: "history", label: "Storia",   icon: "time-outline"   as const },
];
const SIDE_TABS_RIGHT = [
  { name: "profile", label: "Profilo", icon: "person-outline" as const },
];

function CustomTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const routeIndex = (name: string) => state.routes.findIndex((r: any) => r.name === name);

  const renderTab = (tab: { name: string; label: string; icon: any }) => {
    const active = state.index === routeIndex(tab.name);
    return (
      <Pressable key={tab.name} onPress={() => navigation.navigate(tab.name)} style={tb.tab}>
        <Ionicons name={tab.icon} size={19} color={active ? theme.colors.text : theme.colors.textMuted} />
        {active ? (
          <GradientText style={tb.label}>{tab.label}</GradientText>
        ) : (
          <Text style={[tb.label, { color: theme.colors.textMuted }]}>{tab.label}</Text>
        )}
      </Pressable>
    );
  };

  return (
    <View style={[tb.wrap, { paddingBottom: Math.max(insets.bottom, 14) }]} pointerEvents="box-none">
      <BlurView intensity={40} tint="dark" style={[tb.bar, shadowCard]}>
        {SIDE_TABS.map(renderTab)}
        <Pressable onPress={() => navigation.navigate("generate")} style={tb.fabWrap}>
          <LinearGradient colors={MAGIC_GRADIENT} {...AURORA_ANGLE} style={[tb.fab, shadowAurora]}>
            <Ionicons name="sparkles" size={24} color={theme.colors.onGradient} />
          </LinearGradient>
          <GradientText style={tb.fabLabel}>Genera</GradientText>
        </Pressable>
        {SIDE_TABS_RIGHT.map(renderTab)}
      </BlurView>
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
    bottom: 14,
    left: 16,
    right: 16,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    height: 66,
    paddingHorizontal: 10,
    borderRadius: theme.radius.lg + 2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(16,16,22,0.72)",
    overflow: "hidden",
  },
  tab: {
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    minWidth: 60,
    paddingVertical: 6,
  },
  label: {
    fontSize: 9.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  fabWrap: {
    alignItems: "center",
    gap: 3,
    marginTop: -30,
  },
  fab: {
    width: 58,
    height: 58,
    borderRadius: theme.radius.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 5,
    borderColor: theme.colors.bg,
  },
  fabLabel: {
    fontSize: 9.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontWeight: "700",
  },
});

const bellStyles = StyleSheet.create({
  btn: {
    position: "absolute",
    width: 40,
    height: 40,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  emoji: { fontSize: 17, lineHeight: 20 },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: theme.colors.magic2,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: theme.colors.bg,
  },
  badgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
  },
});
