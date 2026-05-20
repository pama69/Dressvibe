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
      // Try multiple loading strategies — on Expo Go SDK 54 the Metro asset
      // bundler intermittently ships a 0-byte TTF for ionicons, breaking
      // every icon in the app. We try the local asset first (instant when it
      // works), then fall back to a public CDN URL (always works, ~400KB
      // download on first launch only).
      const tryLoad = async (label: string, fn: () => Promise<any>): Promise<boolean> => {
        try {
          await fn();
          return true;
        } catch (e: any) {
          console.warn(`[fonts] ${label} failed:`, e?.message || e);
          return false;
        }
      };

      // 1) Local explicit require — fast path
      let ok = await tryLoad("local-ttf", () => Font.loadAsync({
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        Ionicons: require("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf"),
      }));
      // 2) Wrapper API — different code path inside @expo/vector-icons
      if (!ok) {
        ok = await tryLoad("Ionicons.font", () => Font.loadAsync({ ...Ionicons.font }));
      }
      // 3) Remote CDN — bulletproof fallback that ignores Metro/asset bugs
      if (!ok) {
        ok = await tryLoad("cdn", () => Font.loadAsync({
          Ionicons: {
            uri: "https://cdn.jsdelivr.net/npm/@expo/vector-icons@15.0.3/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf",
          },
        }));
      }
      // Never block the UI even if all 3 strategies fail — the user will see
      // tofu boxes for icons but at least the app is usable. The bell badge,
      // labels and screens still work without icons.
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
