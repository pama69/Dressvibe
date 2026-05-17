import { Alert, Platform } from "react-native";

/**
 * Cross-platform yes/no confirm. On web uses window.confirm, on native uses Alert.alert.
 * Resolves true when the user confirms, false otherwise.
 */
export function confirm(title: string, message?: string, destructiveText = "Elimina"): Promise<boolean> {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const ok = window.confirm(message ? `${title}\n\n${message}` : title);
    return Promise.resolve(ok);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Annulla", style: "cancel", onPress: () => resolve(false) },
      { text: destructiveText, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}
