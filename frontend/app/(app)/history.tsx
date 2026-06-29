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
import { LiquidCard } from "@/src/components/LiquidCard";

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
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

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

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(items.map((i) => i.id)));
  const clearSelection = () => { setSelected(new Set()); setSelecting(false); };

  const handleDelete = async (g: GenItem) => {
    const ok = await confirm({
      title: "Eliminare la generazione?",
      message: `"${g.title || "Generazione"}" e tutte le sue immagini saranno rimossi.`,
    });
    if (!ok) return;
    setItems((prev) => prev.filter((x) => x.id !== g.id));
    try { await api.deleteGeneration(g.id); } catch (e) { console.warn(e); load(); }
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    const ok = await confirm({
      title: `Eliminare ${selected.size} ${selected.size === 1 ? "generazione" : "generazioni"}?`,
      message: "Tutte le immagini associate saranno rimosse definitivamente.",
    });
    if (!ok) return;
    setDeleting(true);
    const ids = Array.from(selected);
    setItems((prev) => prev.filter((x) => !selected.has(x.id)));
    clearSelection();
    try {
      await Promise.all(ids.map((id) => api.deleteGeneration(id)));
    } catch (e) {
      console.warn(e);
      load();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>ARCHIVIO</Text>
          <Text style={styles.title}>Le tue creazioni</Text>
        </View>
        {!loading && items.length > 0 && (
          selecting ? (
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={selectAll} style={styles.actionBtn}>
                <Text style={styles.actionBtnText}>Tutti</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={clearSelection} style={styles.actionBtn}>
                <Text style={styles.actionBtnText}>Annulla</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setSelecting(true)} style={styles.actionBtn}>
              <Ionicons name="checkmark-circle-outline" size={16} color={theme.colors.textSecondary} />
              <Text style={styles.actionBtnText}>Seleziona</Text>
            </TouchableOpacity>
          )
        )}
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
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 120 }}
          ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={theme.colors.text}
            />
          }
          renderItem={({ item }) => {
            const isSelected = selected.has(item.id);
            return (
              <LiquidCard
                style={[styles.row, isSelected && styles.rowSelected]}
                testID={`history-item-${item.id}`}
              >
                {selecting && (
                  <TouchableOpacity
                    onPress={() => toggleSelect(item.id)}
                    style={styles.checkWrap}
                    hitSlop={8}
                  >
                    <View style={[styles.check, isSelected && styles.checkActive]}>
                      {isSelected && <Ionicons name="checkmark" size={13} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => selecting ? toggleSelect(item.id) : router.push(`/results/${item.id}`)}
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
                  {!selecting && <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />}
                </TouchableOpacity>
                {!selecting && (
                  <TouchableOpacity
                    onPress={() => handleDelete(item)}
                    style={styles.rowDelete}
                    testID={`history-delete-${item.id}`}
                    hitSlop={8}
                  >
                    <Text style={styles.deleteEmoji}>🗑️</Text>
                  </TouchableOpacity>
                )}
              </LiquidCard>
            );
          }}
        />
      )}

      {selecting && selected.size > 0 && (
        <View style={styles.bulkBar}>
          <TouchableOpacity
            style={[styles.bulkBtn, deleting && { opacity: 0.5 }]}
            onPress={handleBulkDelete}
            disabled={deleting}
          >
            {deleting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="trash-outline" size={18} color="#fff" />
                <Text style={styles.bulkBtnText}>
                  Elimina {selected.size} {selected.size === 1 ? "elemento" : "elementi"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24,
    flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between",
  },
  eyebrow: { color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 3 },
  title: { color: theme.colors.text, fontSize: 30, fontWeight: "300", letterSpacing: -1, marginTop: 6 },
  headerActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 12, borderWidth: 1,
    borderColor: "rgba(180,150,255,0.2)",
    backgroundColor: "#111128",
  },
  actionBtnText: { color: theme.colors.textSecondary, fontSize: 12 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 30 },
  emptyTitle: { color: theme.colors.text, fontSize: 16 },
  emptySub: { color: theme.colors.textSecondary, fontSize: 13, textAlign: "center" },
  row: {
    flexDirection: "row", alignItems: "stretch",
    borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(180,150,255,0.18)",
    shadowColor: "#7c3aed",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
    overflow: "hidden",
  },
  rowSelected: {
    borderColor: "rgba(180,150,255,0.55)",
    shadowOpacity: 0.45,
  },
  checkWrap: {
    paddingLeft: 12, alignItems: "center", justifyContent: "center",
  },
  check: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: "rgba(180,150,255,0.4)",
    alignItems: "center", justifyContent: "center",
    backgroundColor: "transparent",
  },
  checkActive: {
    backgroundColor: "#7c3aed",
    borderColor: "#7c3aed",
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
  bulkBar: {
    position: "absolute", bottom: 90, left: 24, right: 24,
    shadowColor: "#7c3aed", shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
  bulkBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 16,
    backgroundColor: "#7c3aed",
  },
  bulkBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
