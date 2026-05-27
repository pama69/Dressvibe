import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { presetSelectionStore } from "@/src/state/presetSelection";

type Preset = {
  id: string;
  name: string;
  gender: string;
  ethnicity: string;
  age: number;
  thumb_base64: string;
  order?: number;
};

export default function ModelPicker() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  // 3-column grid with 16px outer padding and 10px gutters
  const cardW = Math.floor((width - 16 * 2 - 10 * 2) / 3);
  const cardH = Math.round(cardW * (3 / 2)); // 2:3 portrait

  const [items, setItems] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listModelPresets("female");
      setItems(data);
    } catch (e: any) {
      setError(e?.message || "Errore nel caricamento dei volti");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pick = (p: Preset) => {
    try { Haptics.selectionAsync(); } catch {}
    presetSelectionStore.set({
      id: p.id,
      name: p.name,
      thumb_base64: p.thumb_base64,
    });
    router.back();
  };

  const ethnicityLabel = (e: string) =>
    e === "nordic" ? "Nord Europa"
      : e === "mediterranean" ? "Mediterranea"
      : e;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="model-picker-back" activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>GALLERIA MODELLE</Text>
          <Text style={styles.title}>Scegli un volto</Text>
        </View>
      </View>

      <Text style={styles.hint}>
        15 volti generati con AI, età 20-30, mix mediterraneo e nord europeo. Tocca uno per applicarlo alla prossima generazione.
      </Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.text} />
          <Text style={styles.dim}>Carico la galleria…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={32} color={theme.colors.textMuted} />
          <Text style={styles.errText}>{error}</Text>
          <TouchableOpacity onPress={load} style={styles.retry} testID="model-picker-retry" activeOpacity={0.7}>
            <Text style={styles.retryText}>Riprova</Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.dim}>Nessun volto disponibile.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {items.map((p) => (
            <TouchableOpacity
              key={p.id}
              onPress={() => pick(p)}
              style={[styles.card, { width: cardW }]}
              testID={`pick-model-${p.id}`}
              activeOpacity={0.85}
            >
              <Image
                source={{ uri: `data:image/jpeg;base64,${p.thumb_base64}` }}
                style={{ width: cardW, height: cardH, backgroundColor: "#111" }}
                resizeMode="cover"
              />
              <View style={styles.cardMeta}>
                <Text style={styles.cardName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.cardSub} numberOfLines={1}>
                  {p.age} • {ethnicityLabel(p.ethnicity)}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
          <View style={{ height: 80 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6,
  },
  backBtn: {
    width: 40, height: 40, alignItems: "center", justifyContent: "center",
  },
  eyebrow: {
    color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 2,
    textTransform: "uppercase",
  },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: "700", marginTop: 2 },
  hint: {
    color: theme.colors.textMuted, fontSize: 12, lineHeight: 17,
    paddingHorizontal: 16, paddingBottom: 12,
  },
  grid: {
    paddingHorizontal: 16, paddingTop: 4,
    flexDirection: "row", flexWrap: "wrap",
    gap: 10,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  cardMeta: { padding: 8, gap: 2 },
  cardName: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
  cardSub: { color: theme.colors.textMuted, fontSize: 10, letterSpacing: 0.3 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  dim: { color: theme.colors.textMuted, fontSize: 12 },
  errText: { color: theme.colors.error, fontSize: 13, textAlign: "center" },
  retry: {
    marginTop: 6, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  retryText: { color: theme.colors.text, fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase" },
});
