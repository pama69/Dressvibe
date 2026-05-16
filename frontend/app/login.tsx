import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/contexts/AuthContext";
import { theme, MAGIC_GRADIENT } from "@/src/theme";

const HERO_BG =
  "https://static.prod-images.emergentagent.com/jobs/c1b3d46b-a98d-4423-a9d4-2841a2073b32/images/ed6e2d9050a5c6379f9a25571187e3c6ec908017286a2484188d806b5f2598bc.png";

export default function Login() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);

  const handleSignIn = async () => {
    try {
      setBusy(true);
      await signIn();
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Accesso non riuscito");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ImageBackground source={{ uri: HERO_BG }} style={styles.bg} resizeMode="cover">
      <LinearGradient
        colors={["rgba(5,5,5,0.4)", "rgba(5,5,5,0.85)", "#050505"]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <Text style={styles.eyebrow} testID="login-eyebrow">
            ATELIER DIGITALE
          </Text>
          <Text style={styles.brand} testID="login-brand">
            DressVibe
          </Text>
        </View>

        <View style={styles.middle}>
          <Text style={styles.headline}>
            Vesti i tuoi capi su{"\n"}modelli reali.
          </Text>
          <Text style={styles.sub}>
            Trasforma una foto del tuo negozio in un servizio fotografico di moda,
            in pochi secondi.
          </Text>
        </View>

        <View style={styles.bottom}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleSignIn}
            disabled={busy}
            testID="login-google-button"
            style={styles.googleBtn}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.primaryFg} />
            ) : (
              <>
                <Ionicons name="logo-google" size={20} color={theme.colors.primaryFg} />
                <Text style={styles.googleText}>Accedi con Google</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.magicHint}>
            <LinearGradient
              colors={MAGIC_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.dot}
            />
            <Text style={styles.hint}>
              Powered by AI · Realistico · Pronto in 30s
            </Text>
          </View>

          <Text style={styles.legal}>
            Continuando accetti i Termini e l'Informativa Privacy.
          </Text>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: theme.colors.bg },
  safe: { flex: 1, paddingHorizontal: 28, justifyContent: "space-between" },
  top: { paddingTop: 24 },
  eyebrow: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    letterSpacing: 4,
    textTransform: "uppercase",
  },
  brand: {
    color: theme.colors.text,
    fontSize: 38,
    fontWeight: "300",
    letterSpacing: -1,
    marginTop: 6,
    fontFamily: Platform.select({ ios: "Cormorant Garamond", default: undefined }),
  },
  middle: { gap: 16 },
  headline: {
    color: theme.colors.text,
    fontSize: 44,
    lineHeight: 48,
    fontWeight: "300",
    letterSpacing: -1.5,
  },
  sub: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 320,
  },
  bottom: { paddingBottom: 8, gap: 18 },
  googleBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 18,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  googleText: {
    color: theme.colors.primaryFg,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  magicHint: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 999 },
  hint: { color: theme.colors.textSecondary, fontSize: 12, letterSpacing: 1 },
  legal: { color: theme.colors.textMuted, fontSize: 11, textAlign: "center" },
});
