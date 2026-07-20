import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { useConfirm } from "@/src/contexts/ConfirmContext";
import { GradientText, Card, PhotoFrame, type as noirType } from "@/src/components/noir";

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
          <View style={styles.titleRow}>
            <Text style={styles.title}>Le tue </Text>
            <GradientText style={styles.titleItalic}>creazioni</GradientText>
          </View>
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
              <View testID={`history-item-${item.id}`}>
                <Card style={[styles.row, isSelected ? styles.rowSelected : undefined]}>
                  {selecting && (
                    <TouchableOpacity
                      onPress={() => toggleSelect(item.id)}
                      style={styles.checkWrap}
                      hitSlop={8}
                    >
                      <View style={[styles.check, isSelected ? styles.checkActive : undefined]}>
                        {isSelected && <Ionicons name="checkmark" size={13} color={theme.colors.onGradient} />}
                      </View>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => selecting ? toggleSelect(item.id) : router.push(`/results/${item.id}`)}
                    style={styles.rowInner}
                  >
                    {item.thumbnail ? (
                      <PhotoFrame
                        source={{ uri: `data:image/jpeg;base64,${item.thumbnail}` }}
                        style={styles.thumb}
                      />
                    ) : (
                      <View style={[styles.thumb, styles.thumbEmpty]}>
                        <Ionicons name="image-outline" size={20} color={theme.colors.textMuted} />
                      </View>
                    )}
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
                      <Ionicons name="trash-outline" size={18} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </Card>
              </View>
            );
          }}
        />
      )}

      {selecting && selected.size > 0 && (
        <View style={styles.bulkBar}>
          <TouchableOpacity
            style={[styles.bulkBtn, deleting ? { opacity: 0.5 } : undefined]}
            onPress={handleBulkDelete}
            disabled={deleting}
          >
            {deleting ? (
              <ActivityIndicator color={theme.colors.text} size="small" />
            ) : (
              <>
                <Ionicons name="trash-outline" size={18} color={theme.colors.text} />
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
  eyebrow: { ...noirType.eyebrow, color: theme.colors.textMuted },
  titleRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 6 },
  title: { ...noirType.display, fontSize: 28 },
  titleItalic: { ...noirType.display, fontSize: 28, fontStyle: "italic" },
  headerActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: theme.radius.sm, borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  actionBtnText: { color: theme.colors.textSecondary, fontSize: 12 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 30 },
  emptyTitle: { color: theme.colors.text, fontSize: 16 },
  emptySub: { color: theme.colors.textSecondary, fontSize: 13, textAlign: "center" },
  row: {
    flexDirection: "row", alignItems: "stretch", gap: 12, padding: 12,
  },
  rowSelected: {
    borderColor: theme.colors.borderStrong,
  },
  checkWrap: {
    alignItems: "center", justifyContent: "center",
  },
  check: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: theme.colors.borderStrong,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "transparent",
  },
  checkActive: {
    backgroundColor: theme.colors.text,
    borderColor: theme.colors.text,
  },
  rowInner: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 14,
  },
  rowDelete: {
    paddingLeft: 14, alignItems: "center", justifyContent: "center",
    borderLeftWidth: 1, borderLeftColor: theme.colors.border,
  },
  thumb: { width: 78, height: 98, borderRadius: 14, backgroundColor: theme.colors.surfaceAlt },
  thumbEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border },
  rowTitle: { ...noirType.display, fontSize: 14.5, lineHeight: 18 },
  rowMeta: { ...noirType.micro, marginTop: 4 },
  bulkBar: {
    position: "absolute", bottom: 90, left: 24, right: 24,
  },
  bulkBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1, borderColor: theme.colors.borderStrong,
  },
  bulkBtnText: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
});
