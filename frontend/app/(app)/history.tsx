import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { useConfirm } from "@/src/contexts/ConfirmContext";

type GenItem = {
  id: string;
  title?: string;
  thumbnail?: string | null;
  image_count?: number;
  status: string;
  created_at: string;
};

export default function History() {
  const router = useRouter();
  const confirm = useConfirm();
  const [items, setItems] = useState<GenItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.listGenerations();
      setItems(list);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleDelete = async (g: GenItem) => {
    const ok = await confirm({
      title: "Eliminare la generazione?",
      message: `"${g.title || "Generazione"}" e tutte le sue immagini saranno rimossi.`,
    });
    if (!ok) return;
    setItems((prev) => prev.filter((x) => x.id !== g.id));
    try {
      await api.deleteGeneration(g.id);
    } catch (e) {
      console.warn(e);
      load();
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>ARCHIVIO</Text>
        <Text style={styles.title}>Le tue creazioni</Text>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={theme.colors.text} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="time-outline" size={42} color={theme.colors.textMuted} />
          <Text style={styles.emptyTitle}>Nessuna generazione</Text>
          <Text style={styles.emptySub}>Le immagini che generi appariranno qui.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
          ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={theme.colors.text}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.row} testID={`history-item-${item.id}`}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => router.push(`/results/${item.id}`)}
                style={styles.rowInner}
              >
                <View style={styles.thumbWrap}>
                  {item.thumbnail ? (
                    <Image source={{ uri: `data:image/jpeg;base64,${item.thumbnail}` }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, styles.thumbEmpty]}>
                      <Ionicons name="image-outline" size={20} color={theme.colors.textMuted} />
                    </View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{item.title || "Generazione"}</Text>
                  <Text style={styles.rowMeta}>
                    {item.image_count || 0} immagini · {item.status === "done" ? "Pronto" : item.status}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleDelete(item)}
                style={styles.rowDelete}
                testID={`history-delete-${item.id}`}
                hitSlop={8}
              >
                <Text style={styles.deleteEmoji}>🗑️</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 },
  eyebrow: { color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 3 },
  title: { color: theme.colors.text, fontSize: 30, fontWeight: "300", letterSpacing: -1, marginTop: 6 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 30 },
  emptyTitle: { color: theme.colors.text, fontSize: 16 },
  emptySub: { color: theme.colors.textSecondary, fontSize: 13, textAlign: "center" },
  row: {
    flexDirection: "row", alignItems: "stretch",
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
    overflow: "hidden",
  },
  rowInner: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 14, padding: 12,
  },
  rowDelete: {
    paddingHorizontal: 14, alignItems: "center", justifyContent: "center",
    borderLeftWidth: 1, borderLeftColor: theme.colors.border,
  },
  deleteEmoji: { fontSize: 20, lineHeight: 24 },
  thumbWrap: {
    width: 64, height: 80,
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 3,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  thumb: { width: "100%", height: "100%", borderRadius: 6, backgroundColor: theme.colors.surfaceAlt },
  thumbEmpty: { alignItems: "center", justifyContent: "center" },
  rowTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "500" },
  rowMeta: { color: theme.colors.textSecondary, fontSize: 11, marginTop: 4 },
});
