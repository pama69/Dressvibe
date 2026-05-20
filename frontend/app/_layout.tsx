import { useEffect, useState } from "react";
import { View, ActivityIndicator, LogBox } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Font from "expo-font";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";
import { AuthProvider } from "@/src/contexts/AuthContext";
import { ConfirmProvider } from "@/src/contexts/ConfirmContext";
import { NotificationsProvider } from "@/src/contexts/NotificationsContext";
import { theme } from "@/src/theme";

// Suppress non-fatal warnings that clutter the dev overlay on Expo Go.
LogBox.ignoreLogs([
  "shadow*",
  "Require cycle:",
  "Font file for ionicons",
  "ExpoFontLoader.loadAsync",
]);

// Some Expo Go SDK 54 builds reject Font.loadAsync internally from inside
// @expo/vector-icons' fallback path, which surfaces as an uncaught promise
// red box even when our own code handles it. We swallow those specific
// rejections globally so the user-facing error overlay stays quiet.
if (typeof globalThis !== "undefined") {
  const g: any = globalThis;
  if (!g.__dvFontRejectionHandlerInstalled) {
    g.__dvFontRejectionHandlerInstalled = true;
    try {
      const tracking = require("promise/setimmediate/rejection-tracking");
      tracking.enable({
        allRejections: true,
        onUnhandled: (_id: any, error: any) => {
          const msg = String(error?.message || error || "");
          if (msg.includes("Font file for ionicons") || msg.includes("ExpoFontLoader")) {
            return; // suppress
          }
          if (__DEV__) console.warn("Unhandled promise rejection:", error);
        },
        onHandled: () => {},
      });
    } catch {}
  }
}

export default function RootLayout() {
  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      // KNOWN BUG (Expo SDK 54 + Expo Go): require() for the Ionicons TTF
      // ships a 0-byte buffer, and Font.loadAsync with `{ uri: ... }` also
      // fails on some Android builds. Solution: download the TTF ourselves
      // via expo-file-system to a local cache path, then ask Font.loadAsync
      // to use that local file:// URI. This works on every platform.
      const CDN = "https://cdn.jsdelivr.net/npm/@expo/vector-icons@15.0.3/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf";
      try {
        const localPath = `${FileSystem.cacheDirectory}Ionicons.ttf`;
        let info: any = null;
        try { info = await FileSystem.getInfoAsync(localPath); } catch {}
        if (!info?.exists || (info.size || 0) < 10000) {
          // Download fresh — the file is 389KB.
          const dl = await FileSystem.downloadAsync(CDN, localPath);
          console.log("[fonts] downloaded Ionicons.ttf:", dl.status, "→", localPath);
        }
        await Font.loadAsync({ Ionicons: localPath });
        console.log("[fonts] Ionicons loaded successfully from", localPath);
      } catch (e: any) {
        console.warn("[fonts] download+load chain failed:", e?.message || e);
        // Last-ditch fallback to the bundled asset.
        try { await Font.loadAsync({ ...Ionicons.font }); } catch {}
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
