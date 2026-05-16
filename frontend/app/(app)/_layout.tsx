import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/contexts/AuthContext";
import { theme } from "@/src/theme";
import { View, ActivityIndicator } from "react-native";

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
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.text,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.bg,
          borderTopColor: theme.colors.border,
          borderTopWidth: 1,
          height: 72,
          paddingTop: 8,
          paddingBottom: 16,
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
        options={{
          title: "Galleria",
          tabBarIcon: ({ color }) => <Ionicons name="grid-outline" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="generate"
        options={{
          title: "Genera",
          tabBarIcon: ({ color }) => <Ionicons name="sparkles-outline" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "Storia",
          tabBarIcon: ({ color }) => <Ionicons name="time-outline" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profilo",
          tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={20} color={color} />,
        }}
      />
    </Tabs>
  );
}
