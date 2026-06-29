import React from "react";
import { Tabs, Redirect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/contexts/AuthContext";
import { useNotifications } from "@/src/contexts/NotificationsContext";
import { theme } from "@/src/theme";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Pressable,
} from "react-native";
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
      <LinearGradient
        colors={["#201e44", "#17153a"]}
        style={tb.bar}
      >
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
                <LinearGradient
                  colors={["#3d3a80", "#28265e"]}
                  style={tb.pillActive}
                >
                  <Ionicons name={tab.icon} size={18} color="#c4b5fd" />
                  <Text style={tb.labelActive}>{tab.label}</Text>
                </LinearGradient>
              ) : (
                <View style={tb.pillInactive}>
                  <Ionicons name={tab.icon} size={18} color={theme.colors.textMuted} />
                  <Text style={tb.labelInactive}>{tab.label}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </LinearGradient>
    </View>
  );
}

export default function AppTabs() {
  const { user, loading } = useAuth();

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
    borderRadius: 20,
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(180,150,255,0.15)",
    shadowColor: "#7c3aed",
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  pill: { flex: 1 },
  pillActive: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(180,150,255,0.35)",
  },
  pillInactive: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 6,
    gap: 2,
  },
  labelActive: {
    color: "#c4b5fd",
    fontSize: 11,
    fontWeight: "600",
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
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  emoji: { fontSize: 20, lineHeight: 24 },
  badge: {
    position: "absolute",
    top: 1,
    right: 1,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#E11D48",
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.bg,
  },
  badgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
