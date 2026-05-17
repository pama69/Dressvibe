import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing, Image } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { theme, MAGIC_GRADIENT } from "@/src/theme";
import { genStore } from "@/src/state/genStore";

const MAGIC_AURA =
  "https://static.prod-images.emergentagent.com/jobs/c1b3d46b-a98d-4423-a9d4-2841a2073b32/images/33ab703b0e70fdfd1677d39ea98e5abb9630c2c54be49fc70ee4e3d4ff3c8e24.png";

const STEPS = [
  "Analisi dei capi…",
  "Selezione del modello ideale…",
  "Composizione dell'outfit…",
  "Rifinitura cinematografica…",
  "Quasi pronto…",
];

export default function Generating() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const rotate = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(rotate, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: true })
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();

    const interval = setInterval(() => {
      setStep((s) => (s + 1) % STEPS.length);
    }, 2400);

    (async () => {
      const params = genStore.get();
      if (!params) {
        router.replace("/(app)");
        return;
      }
      try {
        const res = await api.createGeneration(params);
        genStore.clear();
        if (res?.id) {
          router.replace(`/results/${res.id}`);
        } else {
          router.replace("/(app)/history");
        }
      } catch (e) {
        console.warn("Gen error", e);
        router.replace("/(app)/history");
      } finally {
        clearInterval(interval);
      }
    })();

    return () => clearInterval(interval);
  }, [router, rotate, pulse]);

  const rotateDeg = rotate.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });

  return (
    <View style={s.c}>
      <LinearGradient colors={["#050505", "#0b0b0b", "#050505"]} style={StyleSheet.absoluteFill} />

      <Animated.View style={[s.auraWrap, { transform: [{ rotate: rotateDeg }, { scale }] }]}>
        <Image source={{ uri: MAGIC_AURA }} style={s.aura} />
      </Animated.View>

      <View style={s.center}>
        <View style={s.iconBubble}>
          <LinearGradient colors={MAGIC_GRADIENT} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
          <Ionicons name="sparkles" size={28} color="#fff" />
        </View>

        <Text style={s.headline}>Creazione della{"\n"}magia in corso…</Text>
        <Text style={s.step} testID="generating-step">{STEPS[step]}</Text>

        <View style={s.barTrack}>
          <Animated.View style={[s.bar, { transform: [{ scaleX: pulse }] }]} />
        </View>

        <Text style={s.tip}>Tempo medio: 20–40 secondi</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.colors.bg, alignItems: "center", justifyContent: "center" },
  auraWrap: { position: "absolute", width: 520, height: 520, opacity: 0.35 },
  aura: { width: "100%", height: "100%" },
  center: { alignItems: "center", gap: 24, paddingHorizontal: 32 },
  iconBubble: {
    width: 80, height: 80, alignItems: "center", justifyContent: "center", overflow: "hidden",
    shadowColor: "#E11D48", shadowOpacity: 0.6, shadowRadius: 28, shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  headline: {
    color: theme.colors.text, fontSize: 30, lineHeight: 36, fontWeight: "300",
    textAlign: "center", letterSpacing: -0.8,
  },
  step: { color: theme.colors.textSecondary, fontSize: 13, letterSpacing: 1.5 },
  barTrack: {
    width: 220, height: 2, backgroundColor: theme.colors.border, marginTop: 4, overflow: "hidden",
  },
  bar: { width: "100%", height: 2, backgroundColor: theme.colors.text },
  tip: { color: theme.colors.textMuted, fontSize: 11, letterSpacing: 1 },
});
