import { useEffect, useState } from "react";
import { View, ActivityIndicator, LogBox } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Font from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { AuthProvider } from "@/src/contexts/AuthContext";
import { ConfirmProvider } from "@/src/contexts/ConfirmContext";
import { NotificationsProvider } from "@/src/contexts/NotificationsContext";
import { theme } from "@/src/theme";

// Suppress non-fatal warnings that clutter the dev overlay on Expo Go.
LogBox.ignoreLogs([
  "shadow*",
  "Require cycle:",
]);

export default function RootLayout() {
  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Explicit TTF require — bypasses any @expo/vector-icons resolver
        // weirdness that intermittently returns an empty/0-byte buffer on
        // Expo Go. Doing exactly ONE load keeps the asset registry clean.
        await Font.loadAsync({
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          Ionicons: require("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf"),
        });
      } catch (e) {
        console.warn("Ionicons explicit TTF load failed, trying fallback", e);
        try {
          // Fallback to the wrapper API in case the explicit path doesn't
          // resolve in a future @expo/vector-icons release.
          await Font.loadAsync({ ...Ionicons.font });
        } catch (e2) {
          console.warn("Ionicons fallback load failed", e2);
        }
      }
      setFontsLoaded(true);
    })();
  }, []);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={theme.colors.text} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ConfirmProvider>
        <AuthProvider>
          <NotificationsProvider>
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
            </Stack>
          </NotificationsProvider>
        </AuthProvider>
      </ConfirmProvider>
    </SafeAreaProvider>
  );
}
