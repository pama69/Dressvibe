import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { theme, MAGIC_GRADIENT } from "@/src/theme";
import { genStore } from "@/src/state/genStore";

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
  // Latest accepted gen params (persisted across focus changes for "Retry")
  const paramsRef = useRef<any>(null);
  // Prevents concurrent generation calls (e.g. focus fires twice quickly)
  const inFlightRef = useRef(false);
  const rotate = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  const runGeneration = useCallback(async (params: any) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    try {
      const res = await api.createGeneration(params);
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
            "L'AI sta impiegando troppo tempo a rispondere. Probabilmente è sovraccarica. Riprova tra qualche secondo.",
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
    } finally {
      inFlightRef.current = false;
    }
  }, [router]);

  // Step ticker + intro animations — run ONCE per mount
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

    return () => clearInterval(stepInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Run the generation EVERY TIME this screen becomes focused with fresh
  // params in the store. Using useFocusEffect is critical because expo-router
  // may keep the screen mounted across navigations — useEffect([]) alone
  // would only fire once per app session.
  useFocusEffect(
    useCallback(() => {
      const fresh = genStore.get();
      if (fresh) {
        // Consume params immediately so a second focus won't double-fire.
        genStore.clear();
        paramsRef.current = fresh;
        runGeneration(fresh);
        return;
      }
      // No new params and no previous → bail back to home.
      if (!paramsRef.current && !inFlightRef.current) {
        router.replace("/(app)");
      }
    }, [runGeneration, router])
  );

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

  const handleRetry = () => {
    if (paramsRef.current) runGeneration(paramsRef.current);
  };

  if (error) {
    const canRetry = secondsLeft === 0 && !!paramsRef.current;
    return (
      <View style={s.c}>
        <LinearGradient colors={["#050505", "#0b0b0b", "#050505"]} style={StyleSheet.absoluteFill} />
        <View style={s.center}>
          <View style={s.errorIcon}>
            <Ionicons name="time-outline" size={36} color={theme.colors.text} />
          </View>
          <Text style={s.errTitle}>{error.title}</Text>
          <Text style={s.errMsg}>{error.message}</Text>

          {secondsLeft > 0 ? (
            <Text style={s.countdown}>Riprova fra {secondsLeft}s…</Text>
          ) : null}

          <View style={s.actions}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleRetry}
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
              <Ionicons name="refresh" size={16} color={canRetry ? "#14060B" : theme.colors.textSecondary} />
              <Text style={[s.retryText, !canRetry && s.retryTextDisabled]}>
                {canRetry ? "Riprova ora" : `Attendere ${secondsLeft}s`}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                paramsRef.current = null;
                setError(null);
                router.replace("/(app)/generate");
              }}
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
      <LinearGradient colors={["#050505", theme.colors.bg, "#050505"]} style={StyleSheet.absoluteFill} />

      {/* Native Aurora glow — replaces the old remote Emergent aura image.
          A soft rotating gradient halo behind the sparkle bubble. */}
      <Animated.View style={[s.auraWrap, { opacity: 0.4, transform: [{ rotate: rotateDeg }, { scale }] }]}>
        <LinearGradient
          colors={MAGIC_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.aura}
        />
      </Animated.View>

      <View style={s.center}>
        <Animated.View style={[s.iconBubble, { transform: [{ scale }] }]}>
          <LinearGradient colors={MAGIC_GRADIENT} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
          <Ionicons name="sparkles" size={28} color="#14060B" />
        </Animated.View>

        <Text style={s.headline}>La modella sta{"\n"}<Text style={s.headlineEm}>indossando i tuoi capi</Text></Text>
        <Text style={s.step} testID="generating-step">{STEPS[step]}</Text>

        {/* Skeleton dei 3 scatti in arrivo (feedback di caricamento) */}
        <View style={s.skelRow}>
          {[0, 1, 2].map((i) => (
            <Animated.View
              key={i}
              style={[s.skel, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] }) }]}
            />
          ))}
        </View>

        <View style={s.barTrack}>
          <Animated.View style={[s.bar, { transform: [{ scaleX: pulse }] }]}>
            <LinearGradient colors={MAGIC_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
        </View>

        <Text style={s.tip}>Tempo medio: 20–40 secondi</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.colors.bg, alignItems: "center", justifyContent: "center" },
  auraWrap: { position: "absolute", width: 420, height: 420 },
  aura: { width: "100%", height: "100%", borderRadius: 210 },
  center: { alignItems: "center", gap: 22, paddingHorizontal: 32 },
  iconBubble: {
    width: 76, height: 76, borderRadius: 30, alignItems: "center", justifyContent: "center", overflow: "hidden",
    shadowColor: theme.colors.magic2, shadowOpacity: 0.55, shadowRadius: 30, shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  headline: {
    color: theme.colors.text, fontFamily: theme.font.display, fontSize: 27, lineHeight: 32, fontWeight: "500",
    textAlign: "center", letterSpacing: -0.4,
  },
  headlineEm: { fontStyle: "italic", color: theme.colors.magic2 },
  step: { color: theme.colors.textSecondary, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase" },
  skelRow: { flexDirection: "row", gap: 12, marginVertical: 2 },
  skel: {
    width: 78, height: 104, borderRadius: 16,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  barTrack: {
    width: 220, height: 5, borderRadius: 3, backgroundColor: theme.colors.surfaceAlt, marginTop: 2, overflow: "hidden",
  },
  bar: { width: "100%", height: 5, borderRadius: 3, overflow: "hidden" },
  tip: { color: theme.colors.textMuted, fontSize: 11, letterSpacing: 1 },

  // Error UI
  errorIcon: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 1, borderColor: theme.colors.border,
    alignItems: "center", justifyContent: "center",
    backgroundColor: theme.colors.surface,
  },
  errTitle: {
    color: theme.colors.text, fontFamily: theme.font.display, fontSize: 23, fontWeight: "500",
    textAlign: "center", letterSpacing: -0.3,
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
    gap: 10, overflow: "hidden", borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border,
  },
  retryBtnDisabled: { opacity: 0.6 },
  retryText: { color: "#14060B", fontSize: 14, fontWeight: "700", letterSpacing: 0.5 },
  retryTextDisabled: { color: theme.colors.textSecondary },
  cancelBtn: { paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  cancelText: {
    color: theme.colors.textSecondary, fontSize: 12, letterSpacing: 1.5,
    textTransform: "uppercase",
  },
});
