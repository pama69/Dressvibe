import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/contexts/AuthContext";
import { theme } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) router.replace("/(app)");
    else router.replace("/login");
  }, [user, loading, router]);

  return (
    <View style={styles.c} testID="splash-screen">
      <ActivityIndicator color={theme.colors.text} />
    </View>
  );
}

const styles = StyleSheet.create({
  c: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
});
