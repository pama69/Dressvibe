import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/src/contexts/AuthContext";
import { theme } from "@/src/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.bg },
            animation: "fade",
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="(app)" />
          <Stack.Screen
            name="upload"
            options={{ presentation: "modal", animation: "slide_from_bottom" }}
          />
          <Stack.Screen name="generating" options={{ animation: "fade" }} />
          <Stack.Screen name="results/[id]" />
          <Stack.Screen name="studio/[id]" />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
