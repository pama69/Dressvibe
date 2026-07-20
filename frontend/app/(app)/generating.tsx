import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing, Image, TouchableOpacity } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { theme, MAGIC_GRADIENT, AURORA_ANGLE } from "@/src/theme";
import { GradientText, Button, Skeleton, type as noirType, shadowAurora } from "@/src/components/noir";
import { genStore } from "@/src/state/genStore";

// Asset locale (ex Emergent CDN) — nessuna dipendenza esterna.
const MAGIC_AURA = require("@/assets/images/generating-aura.png");

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

  const handleCancel = () => {
    router.replace("/(app)/generate");
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
              <Ionicons name="refresh" size={16} color={canRetry ? theme.colors.onGradient : theme.colors.textSecondary} />
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

  const p = paramsRef.current;
  const garmentsCount = p?.garment_ids?.length ?? 0;
  const shotsCount = p?.num_variations ?? STEPS.length;
  const summaryText = p
    ? `${garmentsCount} cap${garmentsCount === 1 ? "o" : "i"} · ${shotsCount} scatt${shotsCount === 1 ? "o" : "i"} · ~20–40 secondi`
    : "Preparazione dello scatto…";
  const progressPercent = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <View style={s.c}>
      <Animated.View style={[s.auraWrap, { transform: [{ rotate: rotateDeg }, { scale }] }]}>
        <Image source={MAGIC_AURA} style={s.aura} />
      </Animated.View>

      <View style={s.center}>
        <Animated.View style={[s.logo, shadowAurora, { transform: [{ scale }] }]}>
          <LinearGradient colors={MAGIC_GRADIENT} {...AURORA_ANGLE} style={StyleSheet.absoluteFill} />
          <Text style={s.logoGlyph}>✦</Text>
        </Animated.View>

        <View style={s.textBlock}>
          <GradientText style={noirType.eyebrow}>SERVIZIO FOTOGRAFICO IN CORSO</GradientText>
          <Text style={[noirType.display, s.heading]}>Creazione della</Text>
          <GradientText style={[noirType.display, s.heading, s.headingItalic]}>magia in corso…</GradientText>
          <Text style={[noirType.sub, s.summary]}>{summaryText}</Text>
        </View>

        <View style={s.skeletonRow}>
          <Skeleton width={92} height={124} radius={16} delay={0} />
          <Skeleton width={92} height={124} radius={16} delay={200} />
          <Skeleton width={92} height={124} radius={16} delay={400} />
        </View>

        <View style={s.progressTrack}>
          <LinearGradient
            colors={MAGIC_GRADIENT}
            {...AURORA_ANGLE}
            style={[s.progressFill, { width: `${progressPercent}%` }]}
          />
        </View>

        <Text style={[noirType.micro, s.microCenter]} testID="generating-step">
          SCATTO {step + 1} DI {STEPS.length} · {STEPS[step]}
        </Text>

        <Button variant="ghost" small style={s.cancelBtnGrad} onPress={handleCancel}>
          Annulla
        </Button>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.colors.bg, alignItems: "center", justifyContent: "center" },
  auraWrap: { position: "absolute", width: 520, height: 520, opacity: 0.35 },
  aura: { width: "100%", height: "100%" },
  center: { alignItems: "center", gap: 20, paddingHorizontal: 28 },
  logo: {
    width: 74, height: 74, borderRadius: 30, alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  logoGlyph: { fontSize: 32, color: theme.colors.onGradient },
  textBlock: { alignItems: "center", gap: 8 },
  heading: { fontSize: 27, textAlign: "center" },
  headingItalic: { fontStyle: "italic" },
  summary: { textAlign: "center", maxWidth: 300 },
  skeletonRow: { flexDirection: "row", gap: 12, justifyContent: "center" },
  progressTrack: {
    width: 220, height: 5, borderRadius: 3, backgroundColor: theme.colors.surfaceAlt, overflow: "hidden",
  },
  progressFill: { height: 5, borderRadius: 3 },
  microCenter: { textAlign: "center" },
  cancelBtnGrad: { marginTop: 26, alignSelf: "center", width: 130 },

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
  retryText: { color: theme.colors.onGradient, fontSize: 14, fontWeight: "700", letterSpacing: 0.5 },
  retryTextDisabled: { color: theme.colors.textSecondary },
  cancelBtn: { paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  cancelText: {
    color: theme.colors.textSecondary, fontSize: 12, letterSpacing: 1.5,
    textTransform: "uppercase",
  },
});
