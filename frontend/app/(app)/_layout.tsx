import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/contexts/AuthContext";
import { theme } from "@/src/theme";
import { View, ActivityIndicator, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Tab icon factory (module-level — prevents component remount on each render).
const tabIcon = (name: keyof typeof Ionicons.glyphMap) =>
  function TabIcon({ color }: { color: string }) {
    return <Ionicons name={name} size={20} color={color} />;
  };

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
    </Tabs>
  );
}
