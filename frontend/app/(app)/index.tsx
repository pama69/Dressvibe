import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { useAuth } from "@/src/contexts/AuthContext";

type Garment = {
  id: string;
  name: string;
  image_base64: string;
  category: string;
  price?: number | null;
};

export default function Galleria() {
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<Garment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.listGarments();
      setItems(list);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>BENVENUTO</Text>
          <Text style={styles.title} testID="galleria-title">
            {user?.name?.split(" ")[0] || "Atelier"}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.uploadFab}
          onPress={() => router.push("/upload")}
          testID="upload-fab"
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={22} color={theme.colors.primaryFg} />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>La tua galleria</Text>
        <Text style={styles.sectionSub}>{items.length} capi caricati</Text>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={theme.colors.text} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty} testID="empty-gallery">
          <Ionicons name="shirt-outline" size={48} color={theme.colors.textMuted} />
          <Text style={styles.emptyTitle}>Nessun capo ancora</Text>
          <Text style={styles.emptySub}>
            Carica la prima foto del tuo capo per iniziare a creare outfit magici.
          </Text>
          <TouchableOpacity
            onPress={() => router.push("/upload")}
            style={styles.emptyBtn}
            testID="empty-upload-btn"
          >
            <Text style={styles.emptyBtnText}>+ Carica capo</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          numColumns={2}
          contentContainerStyle={styles.list}
          columnWrapperStyle={{ gap: 12 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.text}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.card} testID={`garment-card-${item.id}`}>
              <Image
                source={{ uri: `data:image/png;base64,${item.image_base64}` }}
                style={styles.cardImg}
              />
              <View style={styles.cardOverlay}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.cardMeta}>
                  {item.category}
                  {item.price ? ` · €${item.price}` : ""}
                </Text>
              </View>
            </View>
          )}
        />
      )}

      <TouchableOpacity
        style={styles.generateCta}
        onPress={() => router.push("/(app)/generate")}
        testID="cta-generate"
        activeOpacity={0.85}
      >
        <Ionicons name="sparkles" size={18} color={theme.colors.text} />
        <Text style={styles.generateCtaText}>Vai al Magic Generator</Text>
        <Ionicons name="arrow-forward" size={18} color={theme.colors.text} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  eyebrow: { color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 3 },
  title: {
    color: theme.colors.text,
    fontSize: 32,
    fontWeight: "300",
    letterSpacing: -1,
    marginTop: 4,
  },
  uploadFab: {
    backgroundColor: theme.colors.primary,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  sectionTitle: { color: theme.colors.text, fontSize: 14, letterSpacing: 1 },
  sectionSub: { color: theme.colors.textMuted, fontSize: 12 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 12 },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "400" },
  emptySub: { color: theme.colors.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 28,
    backgroundColor: theme.colors.primary,
  },
  emptyBtnText: { color: theme.colors.primaryFg, fontWeight: "600", letterSpacing: 0.4 },
  list: { paddingHorizontal: 24, paddingBottom: 96 },
  card: {
    flex: 1,
    aspectRatio: 0.78,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  cardImg: { width: "100%", height: "100%" },
  cardOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  cardName: { color: theme.colors.text, fontSize: 13, fontWeight: "500" },
  cardMeta: { color: theme.colors.textSecondary, fontSize: 11, marginTop: 2 },
  generateCta: {
    position: "absolute",
    bottom: 96,
    left: 24,
    right: 24,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  generateCtaText: { color: theme.colors.text, fontSize: 14, letterSpacing: 0.5 },
});
