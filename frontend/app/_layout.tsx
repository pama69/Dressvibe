import { useEffect, useState } from "react";
import { View, ActivityIndicator, LogBox } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Font from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { AuthProvider } from "@/src/contexts/AuthContext";
import { ConfirmProvider } from "@/src/contexts/ConfirmContext";
import { theme } from "@/src/theme";

// Suppress non-fatal warnings that clutter the dev overlay on Expo Go.
LogBox.ignoreLogs([
  "Font file for ionicons is empty",
  "ExpoFontLoader.loadAsync",
  "shadow*",
  "Require cycle:",
]);

export default function RootLayout() {
  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await Font.loadAsync({ ...Ionicons.font });
      } catch (e) {
        console.warn("Font load failed", e);
      } finally {
        setFontsLoaded(true);
      }
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
        </AuthProvider>
      </ConfirmProvider>
    </SafeAreaProvider>
  );
}
