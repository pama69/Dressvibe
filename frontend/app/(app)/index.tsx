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
import { useConfirm, useNotify } from "@/src/contexts/ConfirmContext";

// Module-level flag: the welcome splash should appear only the first time
// the user lands on the gallery during a session. Tabbing away and coming
// back should NOT re-trigger it.
let SPLASH_SHOWN_ONCE = false;

type Garment = {
  id: string;
  name: string;
  image_base64: string;
  thumb_base64?: string;
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
  const notify = useNotify();
  const [items, setItems] = useState<Garment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Cancellazione massiva: in modalità selezione il tap sulla card seleziona
  // invece di aprire il dettaglio, e la barra in basso passa da "Carica Altro"
  // a "Elimina (N)".
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const { width: rawWinW } = useWindowDimensions();
  // Su desktop la griglia resta centrata e non si allarga a tutto schermo.
  const winW = Math.min(rawWinW, 1000);
  const numColumns = colsFor(winW);
  const tileW = Math.floor((winW - PADDING * 2 - GAP * (numColumns - 1)) / numColumns);
  // Card uniformi 4:5: la miniatura è sempre completa (contain) e con la
  // stessa forma, qualunque siano le proporzioni della foto caricata.
  const tileH = Math.round(tileW * (5 / 4));

  // Welcome splash — minimalist intro shown only the first time per session.
  // Just the animated "DressVibe" logo, then auto-dismisses with a soft fade.
  const [showSplash, setShowSplash] = useState(!SPLASH_SHOWN_ONCE);
  const splashFade = useRef(new Animated.Value(1)).current;
  const splashPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!showSplash) return;
    // Soft pulsing animation on the logo
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

    // Auto-dismiss after ~1.6s with a smooth fade — gallery becomes interactive.
    const timer = setTimeout(() => {
      Animated.timing(splashFade, {
        toValue: 0, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start(() => {
        SPLASH_SHOWN_ONCE = true;
        setShowSplash(false);
      });
    }, 1600);

    return () => {
      pulseLoop.stop();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSplash]);

  const [streak, setStreak] = useState<{
    current: number; longest: number; posted_today: boolean; days_idle: number | null;
  } | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const [followers, setFollowers] = useState<{
    connected: boolean; followers?: number; weekly_delta?: number | null;
  } | null>(null);

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
    try {
      const st = await api.getStreak();
      setStreak(st);
    } catch {}
    try {
      const f = await api.getInstagramFollowers();
      setFollowers(f);
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      // La galleria è una tab e resta montata: senza questo la modalità
      // selezione (e i capi spuntati) si ritroverebbe attiva al rientro.
      setSelectMode(false);
      setPicked([]);
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

  const exitSelect = () => {
    setSelectMode(false);
    setPicked([]);
  };

  const togglePick = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const allPicked = items.length > 0 && picked.length === items.length;
  const toggleAll = () => setPicked(allPicked ? [] : items.map((i) => i.id));

  const bulkDelete = async () => {
    if (picked.length === 0 || bulkBusy) return;
    const n = picked.length;
    const ok = await confirm({
      title: `Eliminare ${n} ${n === 1 ? "capo" : "capi"}?`,
      message: "I capi selezionati saranno rimossi definitivamente dalla galleria.",
    });
    if (!ok) return;
    setBulkBusy(true);
    // ponytail: N chiamate in parallelo invece di un endpoint bulk dedicato.
    // Le gallerie sono di qualche decina di capi; se dovessero crescere,
    // aggiungere un DELETE /garments con lista di id.
    const res = await Promise.allSettled(picked.map((gid) => api.deleteGarment(gid)));
    const failed = res.filter((r) => r.status === "rejected").length;
    setBulkBusy(false);
    exitSelect();
    await load();
    if (failed > 0) {
      notify({
        title: "Alcuni capi non sono stati eliminati",
        message: `${n - failed} su ${n} rimossi. Riprova con quelli rimasti.`,
      });
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
        <View style={{ gap: 8, alignItems: "flex-end" }}>
          {streak && streak.current > 0 ? (
            <View style={styles.streakPill} testID="streak-pill">
              <Text style={styles.streakFlame}>🔥</Text>
              <View>
                <Text style={styles.streakNum}>{streak.current}</Text>
                <Text style={styles.streakLbl}>{streak.current === 1 ? "giorno" : "giorni"}</Text>
              </View>
            </View>
          ) : null}
          {followers?.connected && followers.followers != null ? (
            <View style={styles.followerPill} testID="follower-pill">
              <Ionicons name="logo-instagram" size={16} color="#dd2a7b" />
              <Text style={styles.followerNum}>{followers.followers.toLocaleString("it-IT")}</Text>
              {followers.weekly_delta != null && followers.weekly_delta !== 0 ? (
                <Text style={[styles.followerDelta, { color: followers.weekly_delta > 0 ? "#22c55e" : theme.colors.error }]}>
                  {followers.weekly_delta > 0 ? "▲" : "▼"} {Math.abs(followers.weekly_delta)}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

      {/* Nudge: inattività di pubblicazione */}
      {streak && !streak.posted_today && !nudgeDismissed &&
       streak.days_idle != null && streak.days_idle >= 2 ? (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => router.push("/(app)/generate")}
          style={styles.nudge}
          testID="streak-nudge"
        >
          <Text style={styles.nudgeEmoji}>📣</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.nudgeTitle}>
              Sono {streak.days_idle} giorni che non pubblichi!
            </Text>
            <Text style={styles.nudgeSub}>
              La tua vetrina digitale si sta spegnendo. Genera un look e pubblicalo per riaccenderla.
            </Text>
          </View>
          <TouchableOpacity onPress={() => setNudgeDismissed(true)} hitSlop={10} testID="streak-nudge-dismiss">
            <Ionicons name="close" size={18} color={theme.colors.textMuted} />
          </TouchableOpacity>
        </TouchableOpacity>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>La tua galleria</Text>
        <View style={styles.sectionRight}>
          <Text style={styles.sectionSub}>
            {selectMode
              ? `${picked.length} selezionati`
              : `${items.length} capi caricati`}
          </Text>
          {items.length > 0 ? (
            <TouchableOpacity
              onPress={() => (selectMode ? exitSelect() : setSelectMode(true))}
              testID="gallery-select-toggle"
              hitSlop={10}
            >
              <Text style={styles.selectAction}>
                {selectMode ? "Annulla" : "Seleziona"}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
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
          extraData={`${selectMode}:${picked.join(",")}`}
          style={styles.listFrame}
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
            const isPicked = picked.includes(item.id);
            return (
              <TouchableOpacity
                style={[
                  styles.card,
                  { width: tileW, height: tileH },
                  selectMode && isPicked && styles.cardPicked,
                ]}
                testID={`garment-card-${item.id}`}
                activeOpacity={0.85}
                onPress={() =>
                  selectMode
                    ? togglePick(item.id)
                    : router.push(`/(app)/garment/${item.id}`)
                }
                onLongPress={() => {
                  if (!selectMode) {
                    setSelectMode(true);
                    setPicked([item.id]);
                  }
                }}
              >
                <View style={styles.cardInner}>
                  <Image
                    source={{
                      uri: item.thumb_base64
                        ? `data:image/jpeg;base64,${item.thumb_base64}`
                        : `data:image/png;base64,${item.image_base64}`,
                    }}
                    resizeMode="contain"
                    style={styles.cardImg}
                  />
                  {selectMode ? (
                    <View
                      style={[styles.pickBadge, isPicked && styles.pickBadgeOn]}
                      testID={`garment-pick-${item.id}`}
                    >
                      {isPicked ? (
                        <Ionicons name="checkmark" size={16} color={theme.colors.primaryFg} />
                      ) : null}
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => handleDelete(item)}
                      style={styles.deleteBtn}
                      testID={`garment-delete-${item.id}`}
                      activeOpacity={0.7}
                      hitSlop={8}
                    >
                      <Ionicons name="close" size={14} color={theme.colors.text} />
                    </TouchableOpacity>
                  )}
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
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* CTA "Carica Altro" — sostituisce il vecchio "+" nell'header, ora più
          visibile: barra fissa sopra la tab bar, mostrata solo quando la
          galleria ha già almeno un capo (la schermata vuota ha già il suo
          CTA "+ Carica capo"). */}
      {!loading && items.length > 0 ? (
        selectMode ? (
          <View style={styles.bulkBar}>
            <TouchableOpacity
              onPress={toggleAll}
              style={styles.bulkAll}
              testID="gallery-select-all"
              activeOpacity={0.85}
            >
              <Text style={styles.bulkAllText}>
                {allPicked ? "Deseleziona tutti" : "Seleziona tutti"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={bulkDelete}
              disabled={picked.length === 0 || bulkBusy}
              style={[
                styles.bulkDelete,
                (picked.length === 0 || bulkBusy) && { opacity: 0.45 },
              ]}
              testID="gallery-bulk-delete"
              activeOpacity={0.85}
            >
              {bulkBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={16} color="#fff" />
                  <Text style={styles.bulkDeleteText}>
                    Elimina{picked.length > 0 ? ` (${picked.length})` : ""}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => router.push("/upload")}
            style={styles.uploadFabBig}
            testID="upload-fab-big"
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={18} color={theme.colors.primaryFg} />
            <Text style={styles.uploadFabBigText}>Carica Altro</Text>
          </TouchableOpacity>
        )
      ) : null}

      {/* Welcome splash — minimal black overlay with the animated DressVibe
          logo. Auto-fades after ~1.6s and reveals the gallery. No buttons. */}
      {showSplash ? (
        <Animated.View
          style={[styles.splash, { opacity: splashFade }]}
          pointerEvents="none"
        >
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
  streakPill: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(255,150,60,0.5)",
    backgroundColor: "rgba(255,120,40,0.12)",
  },
  streakFlame: { fontSize: 22 },
  streakNum: { color: theme.colors.text, fontSize: 18, fontWeight: "800", lineHeight: 20 },
  streakLbl: { color: theme.colors.textSecondary, fontSize: 9, letterSpacing: 1, textTransform: "uppercase" },
  followerPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(221,42,123,0.45)",
    backgroundColor: "rgba(221,42,123,0.10)",
  },
  followerNum: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  followerDelta: { fontSize: 11, fontWeight: "700" },
  nudge: {
    marginHorizontal: 24, marginTop: 6, marginBottom: 2,
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 14,
    borderWidth: 1, borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface,
  },
  nudgeEmoji: { fontSize: 24 },
  nudgeTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  nudgeSub: { color: theme.colors.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 3 },
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
  sectionRight: { flexDirection: "row", alignItems: "center", gap: 14 },
  selectAction: {
    color: theme.colors.text, fontSize: 12, fontWeight: "700", letterSpacing: 0.4,
  },
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
  listFrame: { width: "100%", maxWidth: 1000, alignSelf: "center" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    overflow: "visible",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  cardInner: {
    borderRadius: 16,
    overflow: "hidden",
    flex: 1,
    padding: 6,
    backgroundColor: "#fff",
  },
  cardImg: { width: "100%", height: "100%", borderRadius: 10, backgroundColor: theme.colors.surfaceAlt },
  deleteBtn: {
    position: "absolute", top: 6, right: 6,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.25)",
  },
  cardPicked: { borderWidth: 3, borderColor: theme.colors.primary },
  pickBadge: {
    position: "absolute", top: 6, right: 6,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.7)",
  },
  pickBadgeOn: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
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
    bottom: 90,
    left: 24,
    right: 24,
    flexDirection: "row",
    gap: 8,
    backgroundColor: theme.colors.primary,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  uploadFabBigText: {
    color: theme.colors.primaryFg,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  // Barra della modalità selezione — stessa posizione/ombra di "Carica Altro",
  // che sostituisce finché la selezione è attiva.
  bulkBar: {
    position: "absolute",
    bottom: 90,
    left: 24,
    right: 24,
    flexDirection: "row",
    gap: 10,
  },
  bulkAll: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface,
  },
  bulkAllText: {
    color: theme.colors.text, fontSize: 13, fontWeight: "600", letterSpacing: 0.4,
  },
  bulkDelete: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.error,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  bulkDeleteText: {
    color: "#fff", fontSize: 14, fontWeight: "700", letterSpacing: 0.6,
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
