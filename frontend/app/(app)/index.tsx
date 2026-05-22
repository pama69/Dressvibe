import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
  Animated,
  Easing,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { theme, MAGIC_GRADIENT } from "@/src/theme";
import { useAuth } from "@/src/contexts/AuthContext";
import { useConfirm } from "@/src/contexts/ConfirmContext";
import { useNotifications } from "@/src/contexts/NotificationsContext";

// Module-level flag: the welcome splash should appear only the first time
// the user lands on the gallery during a session. Tabbing away and coming
// back should NOT re-trigger it.
let SPLASH_SHOWN_ONCE = false;

type Garment = {
  id: string;
  name: string;
  image_base64: string;
  category: string;
  price?: number | null;
};

const PADDING = 24;
const GAP = 12;

function colsFor(width: number): number {
  if (width >= 1400) return 7;
  if (width >= 1100) return 6;
  if (width >= 820) return 5;
  if (width >= 560) return 3;
  return 2;
}

export default function Galleria() {
  const router = useRouter();
  const { user } = useAuth();
  const confirm = useConfirm();
  const { unread } = useNotifications();
  const [items, setItems] = useState<Garment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { width: winW } = useWindowDimensions();
  const numColumns = colsFor(winW);
  const tileW = Math.floor((winW - PADDING * 2 - GAP * (numColumns - 1)) / numColumns);
  const tileH = Math.round(tileW / 0.78);

  // Welcome splash — shown only the first time per session.
  // It stays visible until the user picks one of the 4 quick-action buttons.
  const [showSplash, setShowSplash] = useState(!SPLASH_SHOWN_ONCE);
  const splashFade = useRef(new Animated.Value(1)).current;
  const splashPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!showSplash) return;
    // Soft pulsing animation on the logo (keeps running until dismissed)
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(splashPulse, {
          toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
        Animated.timing(splashPulse, {
          toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();
    return () => { pulseLoop.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSplash]);

  const dismissSplashAndGo = useCallback((target: string | null) => {
    Animated.timing(splashFade, {
      toValue: 0, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start(() => {
      SPLASH_SHOWN_ONCE = true;
      setShowSplash(false);
      if (target) router.push(target as any);
    });
  }, [router, splashFade]);

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

  const handleDelete = async (g: Garment) => {
    const ok = await confirm({
      title: "Eliminare il capo?",
      message: `"${g.name}" sarà rimosso dalla galleria.`,
    });
    if (!ok) return;
    setItems((prev) => prev.filter((x) => x.id !== g.id));
    try {
      await api.deleteGarment(g.id);
    } catch (e) {
      console.warn("delete garment", e);
      load();
    }
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
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          <TouchableOpacity
            style={styles.bell}
            onPress={() => router.push("/notifications")}
            testID="bell-btn"
            activeOpacity={0.7}
          >
            <Text style={styles.bellEmoji}>🔔</Text>
            {unread > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unread > 99 ? "99+" : String(unread)}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.uploadFab}
            onPress={() => router.push("/upload")}
            testID="upload-fab"
            activeOpacity={0.8}
          >
            <Text style={styles.fabPlus}>＋</Text>
          </TouchableOpacity>
        </View>
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
          key={`cols-${numColumns}`}
          keyExtractor={(i) => i.id}
          numColumns={numColumns}
          contentContainerStyle={styles.list}
          columnWrapperStyle={numColumns > 1 ? { gap: GAP } : undefined}
          ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.text}
            />
          }
          renderItem={({ item }) => {
            // Hide auto-generated "Cap NNNN" placeholders in the tile label
            // so the gallery stays visually clean. Real shop descriptions
            // (e.g. "Vestito €59, pantalone €67") are shown normally.
            const isAutoName = /^Cap\s+\d{3,5}$/i.test((item.name || "").trim());
            const displayName = isAutoName ? "" : (item.name || "");
            return (
              <TouchableOpacity
                style={[styles.card, { width: tileW, height: tileH }]}
                testID={`garment-card-${item.id}`}
                activeOpacity={0.85}
                onPress={() => router.push(`/(app)/garment/${item.id}`)}
              >
                <Image
                  source={{
                    // Prefer the small thumb (~10 KB JPEG) coming from the
                    // list endpoint. Older list payloads (pre-thumbnail era)
                    // shipped the full PNG inline — fall back to that.
                    uri: item.thumb_base64
                      ? `data:image/jpeg;base64,${item.thumb_base64}`
                      : `data:image/png;base64,${item.image_base64}`,
                  }}
                  style={styles.cardImg}
                />
                <TouchableOpacity
                  onPress={() => handleDelete(item)}
                  style={styles.deleteBtn}
                  testID={`garment-delete-${item.id}`}
                  activeOpacity={0.7}
                  hitSlop={8}
                >
                  <Ionicons name="close" size={14} color={theme.colors.text} />
                </TouchableOpacity>
                <View style={styles.cardOverlay}>
                  {displayName ? (
                    <Text style={styles.cardName} numberOfLines={1}>
                      {displayName}
                    </Text>
                  ) : null}
                  <Text style={styles.cardMeta}>
                    {item.category}
                    {item.price ? ` · €${item.price}` : ""}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* "Carica un capo" CTA removed per user request — already in header (+) */}

      {/* Welcome splash — full-screen black overlay with animated logo + 4
          quick-action buttons. Stays visible until the user picks an action. */}
      {showSplash ? (
        <Animated.View style={[styles.splash, { opacity: splashFade }]}>
          <LinearGradient
            colors={["#050505", "#0b0b0b", "#050505"]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.splashInner}>
            <Animated.View
              style={{
                transform: [
                  {
                    scale: splashPulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.06],
                    }),
                  },
                ],
                alignItems: "center",
              }}
            >
              <View style={styles.splashLogoWrap}>
                <LinearGradient
                  colors={MAGIC_GRADIENT}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.splashLogoDot}
                />
              </View>
              <Text style={styles.splashTitle}>DressVibe</Text>
              <Animated.View
                style={[
                  styles.splashUnderline,
                  {
                    opacity: splashPulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.25, 1],
                    }),
                  },
                ]}
              />
            </Animated.View>

            <View style={styles.splashActions}>
              <TouchableOpacity
                style={styles.splashAction}
                onPress={() => dismissSplashAndGo("/(app)/generate")}
                testID="splash-generate"
                activeOpacity={0.85}
              >
                <Text style={styles.splashActionEmoji}>✨</Text>
                <Text style={styles.splashActionLabel}>Genera</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.splashAction}
                onPress={() => dismissSplashAndGo("/upload")}
                testID="splash-upload"
                activeOpacity={0.85}
              >
                <Text style={styles.splashActionEmoji}>＋</Text>
                <Text style={styles.splashActionLabel}>Carica capo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.splashAction}
                onPress={() => dismissSplashAndGo("/(app)/history")}
                testID="splash-history"
                activeOpacity={0.85}
              >
                <Text style={styles.splashActionEmoji}>📂</Text>
                <Text style={styles.splashActionLabel}>Storico</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.splashAction}
                onPress={() => dismissSplashAndGo("/(app)/profile")}
                testID="splash-profile"
                activeOpacity={0.85}
              >
                <Text style={styles.splashActionEmoji}>👤</Text>
                <Text style={styles.splashActionLabel}>Profilo</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => dismissSplashAndGo(null)}
              style={styles.splashSkip}
              testID="splash-skip"
              activeOpacity={0.7}
            >
              <Text style={styles.splashSkipText}>Vai alla galleria</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      ) : null}
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
  fabPlus: { color: theme.colors.primaryFg, fontSize: 26, fontWeight: "300", lineHeight: 30, marginTop: -2 },
  bellEmoji: { fontSize: 22, lineHeight: 26 },
  bell: {
    width: 44, height: 44,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  badge: {
    position: "absolute",
    top: 2, right: 2,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: "#E11D48",
    paddingHorizontal: 4,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: theme.colors.bg,
  },
  badgeText: { color: "#fff", fontSize: 9, fontWeight: "700", letterSpacing: 0.2 },
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
  list: { paddingHorizontal: PADDING, paddingBottom: 96 },
  card: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  cardImg: { width: "100%", height: "100%" },
  deleteBtn: {
    position: "absolute", top: 6, right: 6,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.25)",
  },
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
  uploadFabBig: {
    position: "absolute",
    bottom: 96,
    left: 24,
    right: 24,
    backgroundColor: theme.colors.primary,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadFabBigText: {
    color: theme.colors.primaryFg,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  // Welcome splash
  splash: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    paddingVertical: 40,
  },
  splashLogoWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 18,
    shadowColor: "#E11D48",
    shadowOpacity: 0.55,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  splashLogoDot: {
    width: "100%",
    height: "100%",
  },
  splashTitle: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "300",
    letterSpacing: 2,
  },
  splashUnderline: {
    marginTop: 14,
    width: 60,
    height: 1.5,
    backgroundColor: "#E11D48",
  },
  splashInner: {
    width: "100%",
    maxWidth: 360,
    paddingHorizontal: 28,
    paddingTop: 40,
    paddingBottom: 30,
    alignItems: "center",
    justifyContent: "space-between",
    flex: 1,
  },
  splashActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center",
    marginTop: 40,
    width: "100%",
  },
  splashAction: {
    flexBasis: "45%",
    flexGrow: 1,
    minHeight: 92,
    paddingVertical: 18,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  splashActionEmoji: { fontSize: 28, lineHeight: 32 },
  splashActionLabel: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    textAlign: "center",
  },
  splashSkip: {
    marginTop: 22,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  splashSkipText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
});
