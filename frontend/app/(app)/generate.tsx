import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api/client";
import { theme, MAGIC_GRADIENT } from "@/src/theme";
import {
  GENDERS,
  AGES,
  BODIES,
  ETHNICITIES,
  POSES,
  BACKGROUNDS,
  SHOES,
  VARIATIONS,
  Option,
} from "@/src/constants/options";
import { genStore } from "@/src/state/genStore";

type Garment = { id: string; name: string; image_base64: string; category: string };

function ChipRow({
  label,
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  testIDPrefix: string;
}) {
  return (
    <View style={chipStyles.wrap}>
      <Text style={chipStyles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={chipStyles.row}>
        {options.map((o) => {
          const active = value === o.value;
          return (
            <TouchableOpacity
              key={o.value}
              onPress={() => onChange(o.value)}
              style={[chipStyles.chip, active && chipStyles.chipActive]}
              testID={`${testIDPrefix}-${o.value}`}
              activeOpacity={0.8}
            >
              <Text style={[chipStyles.chipText, active && chipStyles.chipTextActive]}>
                {o.emoji ? `${o.emoji}  ` : ""}{o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function Generate() {
  const router = useRouter();
  const [garments, setGarments] = useState<Garment[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  const [gender, setGender] = useState("donna");
  const [age, setAge] = useState("adulto");
  const [body, setBody] = useState("slim");
  const [eth, setEth] = useState("caucasica");
  const [pose, setPose] = useState("casual_standing");
  const [bg, setBg] = useState("white_studio");
  const [shoes, setShoes] = useState("comoda_fashion");
  const [variations, setVariations] = useState(4);

  const load = useCallback(async () => {
    try {
      const list = await api.listGarments();
      setGarments(list);
    } catch (e) {
      console.warn(e);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const onGenerate = () => {
    if (selected.length === 0) {
      Alert.alert("Seleziona almeno un capo", "Tocca uno o più capi dalla tua galleria per continuare.");
      return;
    }
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    genStore.set({
      garment_ids: selected,
      model_gender: gender,
      model_age: age,
      model_body: body,
      model_ethnicity: eth,
      pose,
      background: bg,
      shoes,
      num_variations: variations,
    });
    router.push("/generating");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>MAGIC OUTFIT GENERATOR</Text>
        <Text style={styles.title}>Crea il tuo{"\n"}servizio fotografico.</Text>

        {/* Step 1 - garments */}
        <View style={styles.step}>
          <View style={styles.stepHead}>
            <Text style={styles.stepLabel}>1 — Capi</Text>
            <Text style={styles.stepHint}>{selected.length} selezionati</Text>
          </View>
          {garments.length === 0 ? (
            <TouchableOpacity
              style={styles.emptyGarment}
              onPress={() => router.push("/upload")}
              testID="generate-empty-upload"
            >
              <Ionicons name="cloud-upload-outline" size={20} color={theme.colors.text} />
              <Text style={styles.emptyGarmentText}>Carica il tuo primo capo</Text>
            </TouchableOpacity>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.garmentRow}>
              {garments.map((g) => {
                const active = selected.includes(g.id);
                return (
                  <TouchableOpacity
                    key={g.id}
                    onPress={() => toggle(g.id)}
                    style={[styles.garment, active && styles.garmentActive]}
                    activeOpacity={0.85}
                    testID={`select-garment-${g.id}`}
                  >
                    <Image source={{ uri: `data:image/png;base64,${g.image_base64}` }} style={styles.garmentImg} />
                    {active && (
                      <View style={styles.checkBadge}>
                        <Ionicons name="checkmark" size={14} color={theme.colors.primaryFg} />
                      </View>
                    )}
                    <Text style={styles.garmentName} numberOfLines={1}>{g.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* Step 2 — Model */}
        <View style={styles.step}>
          <Text style={styles.stepLabel}>2 — Modello</Text>
          <ChipRow label="Genere" options={GENDERS} value={gender} onChange={setGender} testIDPrefix="gender" />
          <ChipRow label="Età" options={AGES} value={age} onChange={setAge} testIDPrefix="age" />
          <ChipRow label="Corporatura" options={BODIES} value={body} onChange={setBody} testIDPrefix="body" />
          <ChipRow label="Etnia" options={ETHNICITIES} value={eth} onChange={setEth} testIDPrefix="eth" />
        </View>

        {/* Step 3 — Scene */}
        <View style={styles.step}>
          <Text style={styles.stepLabel}>3 — Scena</Text>
          <ChipRow label="Posa" options={POSES} value={pose} onChange={setPose} testIDPrefix="pose" />
          <ChipRow label="Sfondo" options={BACKGROUNDS} value={bg} onChange={setBg} testIDPrefix="bg" />
          <ChipRow label="Scarpe" options={SHOES} value={shoes} onChange={setShoes} testIDPrefix="shoes" />
        </View>

        {/* Step 4 — Variations */}
        <View style={styles.step}>
          <Text style={styles.stepLabel}>4 — Variazioni</Text>
          <View style={styles.varsRow}>
            {VARIATIONS.map((n) => {
              const active = variations === n;
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => setVariations(n)}
                  style={[styles.varBtn, active && styles.varBtnActive]}
                  testID={`var-${n}`}
                >
                  <Text style={[styles.varText, active && styles.varTextActive]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Magic button */}
      <View style={styles.ctaWrap}>
        <TouchableOpacity activeOpacity={0.9} onPress={onGenerate} testID="genera-outfit-button">
          <LinearGradient
            colors={MAGIC_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cta}
          >
            <Ionicons name="sparkles" size={20} color="#fff" />
            <Text style={styles.ctaText}>Genera Outfit Realistico</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 },
  eyebrow: { color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 3 },
  title: { color: theme.colors.text, fontSize: 30, lineHeight: 34, fontWeight: "300", letterSpacing: -1, marginTop: 6 },
  step: { marginTop: 28, gap: 12 },
  stepHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stepLabel: { color: theme.colors.text, fontSize: 12, letterSpacing: 2, textTransform: "uppercase" },
  stepHint: { color: theme.colors.textSecondary, fontSize: 11 },
  emptyGarment: {
    borderWidth: 1, borderColor: theme.colors.border, borderStyle: "dashed",
    paddingVertical: 22, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 10,
  },
  emptyGarmentText: { color: theme.colors.text, fontSize: 14 },
  garmentRow: { gap: 12, paddingRight: 12 },
  garment: {
    width: 110, borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, overflow: "hidden",
  },
  garmentActive: { borderColor: theme.colors.text, borderWidth: 2 },
  garmentImg: { width: "100%", height: 130 },
  garmentName: { color: theme.colors.textSecondary, fontSize: 11, padding: 8 },
  checkBadge: {
    position: "absolute", top: 6, right: 6, width: 22, height: 22,
    backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center",
  },
  varsRow: { flexDirection: "row", gap: 10 },
  varBtn: {
    flex: 1, paddingVertical: 16, borderWidth: 1, borderColor: theme.colors.border,
    alignItems: "center",
  },
  varBtnActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  varText: { color: theme.colors.text, fontSize: 16, fontWeight: "500" },
  varTextActive: { color: theme.colors.primaryFg },
  ctaWrap: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: 20, backgroundColor: theme.colors.bg,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
  },
  cta: {
    paddingVertical: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12,
    shadowColor: "#E11D48", shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700", letterSpacing: 0.6 },
});

const chipStyles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 2, textTransform: "uppercase" },
  row: { gap: 8, paddingRight: 12 },
  chip: {
    paddingVertical: 10, paddingHorizontal: 16,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  chipText: { color: theme.colors.text, fontSize: 13, letterSpacing: 0.3 },
  chipTextActive: { color: theme.colors.primaryFg, fontWeight: "600" },
});
