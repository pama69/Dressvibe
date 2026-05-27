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
  Platform,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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

export default function AppTabs() {
  const { user, loading } = useAuth();
  const insets = useSafeAreaInsets();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={theme.colors.text} />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;

  // Push the tab bar above the system gesture / nav bar.
  // On Android (no inset reported) keep a sensible minimum.
  const safeBottom = Math.max(insets.bottom, Platform.OS === "android" ? 12 : 0);
  const tabBarHeight = 60 + safeBottom;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.colors.text,
          tabBarInactiveTintColor: theme.colors.textMuted,
          tabBarStyle: {
            backgroundColor: theme.colors.bg,
            borderTopColor: theme.colors.border,
            borderTopWidth: 1,
            height: tabBarHeight,
            paddingTop: 8,
            paddingBottom: safeBottom + 8,
          },
          tabBarLabelStyle: {
            fontSize: 10,
            letterSpacing: 2,
            textTransform: "uppercase",
          },
        }}
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
