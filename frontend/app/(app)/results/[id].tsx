import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  useWindowDimensions,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";

const GAP = 10;
const CONTENT_PADDING = 24;

function columnsFor(width: number): number {
  if (width >= 1400) return 6;
  if (width >= 1100) return 5;
  if (width >= 820) return 4;
  if (width >= 560) return 3;
  return 2;
}

type Generation = {
  id: string;
  title?: string;
  status: string;
  images: string[];
  params?: any;
};

export default function Results() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [gen, setGen] = useState<Generation | null>(null);
  const [loading, setLoading] = useState(true);
  const { width: winW } = useWindowDimensions();
  const numColumns = columnsFor(winW);
  const tileW = Math.floor((winW - CONTENT_PADDING * 2 - GAP * (numColumns - 1)) / numColumns);
  const tileH = Math.round(tileW * (16 / 9));

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const g = await api.getGeneration(id);
      setGen(g);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Generazione non trovata");
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.replace("/(app)")} testID="results-back">
          <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{gen?.title || "Risultati"}</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={s.loading}><ActivityIndicator color={theme.colors.text} /></View>
      ) : !gen || gen.images.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="cloud-offline-outline" size={42} color={theme.colors.textMuted} />
          <Text style={s.emptyTitle}>Nessuna immagine generata</Text>
          <Text style={s.emptySub}>Riprova con parametri diversi.</Text>
          <TouchableOpacity onPress={() => router.replace("/(app)/generate")} style={s.retry}>
            <Text style={s.retryText}>Riprova</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={gen.images}
          key={`cols-${numColumns}`}
          keyExtractor={(_img, i) => `${i}`}
          numColumns={numColumns}
          contentContainerStyle={{ paddingHorizontal: CONTENT_PADDING, paddingTop: 12, paddingBottom: 40 }}
          columnWrapperStyle={numColumns > 1 ? { gap: GAP, marginBottom: GAP } : undefined}
          ListHeaderComponent={
            <Text style={s.hint}>
              {gen.images.length} variazioni · Tocca un'immagine per modificarla
            </Text>
          }
          renderItem={({ item, index }) => (
            <TouchableOpacity
              onPress={() => router.push({ pathname: "/studio/[id]", params: { id: gen.id, index: String(index) } })}
              activeOpacity={0.85}
              testID={`result-image-${index}`}
            >
              <Image source={{ uri: `data:image/png;base64,${item}` }} style={[s.tile, { width: tileW, height: tileH }]} />
              <View style={s.tileOverlay}>
                <Ionicons name="brush-outline" size={14} color={theme.colors.text} />
                <Text style={s.tileText}>Apri Studio</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    paddingHorizontal: 20, paddingVertical: 14, flexDirection: "row",
    alignItems: "center", justifyContent: "space-between",
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  headerTitle: { color: theme.colors.text, fontSize: 14, letterSpacing: 1.5 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 30 },
  emptyTitle: { color: theme.colors.text, fontSize: 16 },
  emptySub: { color: theme.colors.textSecondary, fontSize: 13, textAlign: "center" },
  retry: { marginTop: 8, paddingVertical: 12, paddingHorizontal: 28, backgroundColor: theme.colors.primary },
  retryText: { color: theme.colors.primaryFg, fontWeight: "600" },
  hint: { color: theme.colors.textSecondary, fontSize: 11, letterSpacing: 1, marginBottom: 14 },
  tile: { backgroundColor: theme.colors.surface },
  tileOverlay: {
    position: "absolute", bottom: 8, left: 8, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)", paddingVertical: 4, paddingHorizontal: 8,
  },
  tileText: { color: theme.colors.text, fontSize: 10, letterSpacing: 1 },
});
