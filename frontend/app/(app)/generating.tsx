import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing, Image, TouchableOpacity } from "react-native";
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

type ErrorState = {
  title: string;
  message: string;
  // 0 = no countdown; otherwise seconds before retry is available
  cooldown: number;
};

export default function Generating() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<ErrorState | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const paramsRef = useRef<any>(null);
  const rotate = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  const startGeneration = async () => {
    setError(null);
    const params = paramsRef.current || genStore.get();
    if (!params) {
      router.replace("/(app)");
      return;
    }
    paramsRef.current = params;

    try {
      const res = await api.createGeneration(params);
      genStore.clear();
      if (res?.id && res?.images && res.images.length > 0) {
        router.replace(`/results/${res.id}`);
      } else {
        setError({
          title: "Nessuna immagine generata",
          message:
            "I modelli AI non hanno restituito nessuna immagine. Riprova tra qualche secondo.",
          cooldown: 15,
        });
        setSecondsLeft(15);
      }
    } catch (e: any) {
      const status = e?.status;
      const code = e?.code;
      const msg = e?.message || "Errore di rete";

      if (status === 429) {
        setError({
          title: "Limite Gemini raggiunto",
          message:
            "Hai raggiunto il limite del free tier Gemini (circa 5 immagini al minuto). " +
            "Aspetta ~30-60 secondi e riprova — la generazione partirà subito.",
          cooldown: 45,
        });
        setSecondsLeft(45);
      } else if (code === "TIMEOUT") {
        setError({
          title: "Il server è lento",
          message:
            "Gemini sta impiegando troppo tempo a rispondere. Probabilmente è sovraccarico. Riprova tra qualche secondo.",
          cooldown: 10,
        });
        setSecondsLeft(10);
      } else {
        setError({
          title: "Errore di generazione",
          message: msg,
          cooldown: 5,
        });
        setSecondsLeft(5);
      }
    }
  };

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

    const stepInterval = setInterval(() => {
      setStep((s) => (s + 1) % STEPS.length);
    }, 2400);

    startGeneration();

    return () => clearInterval(stepInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown timer while error is shown
  useEffect(() => {
    if (!error || secondsLeft <= 0) return;
    const t = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [error, secondsLeft]);

  const rotateDeg = rotate.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });

  if (error) {
    const canRetry = secondsLeft === 0;
    return (
      <View style={s.c}>
        <LinearGradient colors={["#050505", "#0b0b0b", "#050505"]} style={StyleSheet.absoluteFill} />
        <View style={s.center}>
          <View style={s.errorIcon}>
            <Ionicons name="time-outline" size={36} color={theme.colors.text} />
          </View>
          <Text style={s.errTitle}>{error.title}</Text>
          <Text style={s.errMsg}>{error.message}</Text>

          {!canRetry ? (
            <Text style={s.countdown}>
              Riprova fra {secondsLeft}s…
            </Text>
          ) : null}

          <View style={s.actions}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => canRetry && startGeneration()}
              disabled={!canRetry}
              style={[s.retryBtn, !canRetry && s.retryBtnDisabled]}
              testID="retry-generation"
            >
              {canRetry ? (
                <LinearGradient
                  colors={MAGIC_GRADIENT}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              <Ionicons name="refresh" size={16} color={canRetry ? "#fff" : theme.colors.textSecondary} />
              <Text style={[s.retryText, !canRetry && s.retryTextDisabled]}>
                {canRetry ? "Riprova ora" : `Attendere ${secondsLeft}s`}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.replace("/(app)/generate")}
              style={s.cancelBtn}
              testID="cancel-generation"
            >
              <Text style={s.cancelText}>Torna indietro</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

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

  // Error UI
  errorIcon: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: "center", justifyContent: "center",
    backgroundColor: theme.colors.surface,
  },
  errTitle: {
    color: theme.colors.text, fontSize: 22, fontWeight: "600",
    textAlign: "center", letterSpacing: -0.4,
  },
  errMsg: {
    color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20,
    textAlign: "center", maxWidth: 320,
  },
  countdown: {
    color: theme.colors.textMuted, fontSize: 12, letterSpacing: 1,
  },
  actions: { width: "100%", gap: 12, marginTop: 8, maxWidth: 320 },
  retryBtn: {
    paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.border,
  },
  retryBtnDisabled: { opacity: 0.6 },
  retryText: { color: "#fff", fontSize: 14, fontWeight: "700", letterSpacing: 0.5 },
  retryTextDisabled: { color: theme.colors.textSecondary },
  cancelBtn: { paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  cancelText: {
    color: theme.colors.textSecondary, fontSize: 12, letterSpacing: 1.5,
    textTransform: "uppercase",
  },
});
