import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ImageBackground } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme, MAGIC_GRADIENT, AURORA_ANGLE } from "@/src/theme";
import { GradientText, type as noirType, shadowAurora } from "@/src/components/noir";

// Asset locale (ex Emergent CDN) — nessuna dipendenza esterna.
const HERO_BG = require("@/assets/images/login-hero.png");

export default function Login() {
  const router = useRouter();

  return (
    <ImageBackground source={HERO_BG} style={styles.bg} resizeMode="cover">
      <LinearGradient
        colors={["rgba(5,5,5,0.4)", "rgba(5,5,5,0.85)", "#050505"]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <View style={[styles.logoMark, shadowAurora]}>
            <LinearGradient colors={MAGIC_GRADIENT} {...AURORA_ANGLE} style={StyleSheet.absoluteFill} />
            <Text style={styles.logoGlyph}>✦</Text>
          </View>

          <View testID="login-eyebrow">
            <GradientText style={noirType.eyebrow}>ATELIER DIGITALE</GradientText>
          </View>

          <View style={styles.brandRow} testID="login-brand">
            <Text style={styles.brand}>Dress</Text>
            <GradientText style={[styles.brand, styles.brandItalic]}>Vibe</GradientText>
          </View>
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
            onPress={() => router.push("/email-auth")}
            testID="login-email-button"
            style={styles.primaryBtn}
          >
            <Ionicons name="mail-outline" size={20} color={theme.colors.primaryFg} />
            <Text style={styles.primaryBtnText}>Accedi con Email</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => router.push("/email-auth?mode=register")}
            testID="login-register-link"
            style={styles.registerBtn}
          >
            <Text style={styles.registerLink}>
              Non hai un account?  <Text style={styles.registerLinkBold}>Registrati</Text>
            </Text>
          </TouchableOpacity>

          <View style={styles.magicHint}>
            <LinearGradient colors={MAGIC_GRADIENT} {...AURORA_ANGLE} style={styles.dot} />
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
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: 26,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  logoGlyph: {
    color: theme.colors.onGradient,
    fontSize: 28,
  },
  brandRow: { flexDirection: "row", marginTop: 10 },
  brand: {
    color: theme.colors.text,
    fontSize: 38,
    fontWeight: "500",
    letterSpacing: -1,
    fontFamily: theme.font.serif,
  },
  brandItalic: { fontStyle: "italic" },
  middle: { gap: 16 },
  headline: {
    color: theme.colors.text,
    fontSize: 44,
    lineHeight: 48,
    fontWeight: "300",
    letterSpacing: -1.5,
    fontFamily: theme.font.serif,
  },
  sub: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 320,
  },
  bottom: { paddingBottom: 8, gap: 18 },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.md,
    paddingVertical: 18,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  primaryBtnText: {
    color: theme.colors.primaryFg,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  registerBtn: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingVertical: 14,
  },
  registerLink: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    textAlign: "center",
    letterSpacing: 0.3,
  },
  registerLinkBold: {
    color: theme.colors.text,
    fontWeight: "700",
  },
  magicHint: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: theme.radius.pill },
  hint: { color: theme.colors.textSecondary, fontSize: 12, letterSpacing: 1 },
  legal: { color: theme.colors.textMuted, fontSize: 11, textAlign: "center" },
});
