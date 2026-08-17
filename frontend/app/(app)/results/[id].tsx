import React, { useCallback, useEffect, useState } from "react";
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
  ScrollView,
  Platform,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { useConfirm } from "@/src/contexts/ConfirmContext";
import VideoCard from "@/src/components/VideoCard";
import PublishSheet, { PublishChannel } from "@/src/components/PublishSheet";
import { saveVideoToGallery, saveImageToGallery } from "@/src/utils/gallery";
import { useNotify } from "@/src/contexts/ConfirmContext";

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
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const confirm = useConfirm();
  const notify = useNotify();
  const { width: rawWinW } = useWindowDimensions();

  // ── Carousel selection ────────────────────────────────────────────────────
  // When `selectMode` is on, tapping a tile toggles its selection (the order
  // of selection becomes the carousel order). 1 image → single post, 2+ → a
  // carousel. Publishing targets Instagram / Facebook / WhatsApp (no Telegram).
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [chIgFb, setChIgFb] = useState(false);
  const [chWa, setChWa] = useState(false);

  // Su desktop la griglia resta centrata e non si allarga a tutto schermo.
  const winW = Math.min(rawWinW, 1000);
  const numColumns = columnsFor(winW);
  const tileW = Math.floor((winW - CONTENT_PADDING * 2 - GAP * (numColumns - 1)) / numColumns);
  // Tile uniformi 4:5 (come le immagini generate): sempre complete, mai croppate.
  const tileH = Math.round(tileW * (5 / 4));
  const videoTileW = Math.min(280, Math.floor(winW * 0.7));
  const videoTileH = Math.round(videoTileW * (16 / 9));

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [g, vs] = await Promise.all([
        api.getGeneration(id),
        api.listGenerationVideos(id).catch(() => []),
      ]);
      setGen(g);
      setVideos(vs || []);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Generazione non trovata");
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Which social channels are actually configured (drives the publish sheet).
  useEffect(() => {
    (async () => {
      try {
        const st = await api.getUserSettings();
        setChWa(!!st.whatsapp_channel_url);
      } catch {}
      try {
        const z = await api.zernioStatus();
        setChIgFb(!!(z.accounts && z.accounts.some((a) => a.is_active)));
      } catch {}
    })();
  }, []);

  const exitSelect = () => {
    setSelectMode(false);
    setSelected([]);
  };

  // Enter carousel mode with ALL photos preselected (in order) — the common
  // case is "post all of them", so this is one tap. The owner can then
  // deselect any shot before publishing.
  const startCarousel = () => {
    if (!gen) return;
    setSelected(gen.images.map((_, i) => i));
    setSelectMode(true);
  };

  const toggleSelect = (index: number) => {
    setSelected((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const handleDeleteVideo = async (videoId: string) => {
    const ok = await confirm({
      title: "Eliminare video?",
      message: "Il video sarà rimosso definitivamente.",
    });
    if (!ok) return;
    try {
      await api.deleteVideo(videoId);
      setVideos((prev) => prev.filter((v) => v.id !== videoId));
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile eliminare");
    }
  };

  const handleDeleteImage = async (index: number) => {
    if (!gen) return;
    const ok = await confirm({
      title: "Eliminare immagine?",
      message: "Questa variazione sarà rimossa dalla galleria.",
    });
    if (!ok) return;
    const prev = gen.images;
    setGen({ ...gen, images: prev.filter((_, i) => i !== index) });
    try {
      await api.deleteGenerationImage(gen.id, index);
    } catch (e) {
      console.warn("delete image", e);
      setGen({ ...gen, images: prev });
      Alert.alert("Errore", "Impossibile eliminare l'immagine");
    }
  };

  // ── Publish handlers (carousel or single) ─────────────────────────────────
  const publishSocial = async (platform: "instagram" | "facebook") => {
    if (!id || selected.length === 0 || publishing) return;
    setPublishing(true);
    try {
      // Empty caption → the backend auto-generates one (same copywriter as
      // the Studio). image_indexes carries the carousel order.
      const r = await api.zernioPublish({
        gen_id: id,
        image_index: selected[0],
        image_indexes: selected,
        caption: "",
        platforms: [platform],
      });
      if (r?.ok) {
        const what = selected.length > 1 ? `Carosello (${selected.length} foto)` : "Foto";
        await notify({
          title: `Pubblicato su ${platform === "instagram" ? "Instagram" : "Facebook"} ✅`,
          message: `${what} in coda su Meta. Apparirà sul tuo profilo entro 1-2 minuti.`,
        });
        exitSelect();
      }
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.toLowerCase().includes("account non collegato")) {
        await notify({
          title: `${platform === "instagram" ? "Instagram" : "Facebook"} non collegato`,
          message: "Vai in Profilo → Pubblicazione Social e tocca Collega.",
        });
      } else {
        await notify({ title: "Pubblicazione fallita", message: msg || "Riprova fra qualche istante." });
      }
    } finally {
      setPublishing(false);
    }
  };

  // WhatsApp has no "carousel" format: we save the selected photos to the
  // gallery and open the shop's channel so the owner can post them (one or
  // several). Honest multi-post rather than a fake carousel.
  const publishWhatsApp = async () => {
    if (!gen || selected.length === 0 || publishing) return;
    setPublishing(true);
    try {
      let channelUrl = "";
      try {
        const settings = await api.getUserSettings();
        channelUrl = (settings.whatsapp_channel_url || "").trim();
      } catch {}
      if (!channelUrl) {
        await notify({
          title: "Canale WhatsApp non configurato",
          message: "Vai in Profilo → Canale WhatsApp e incolla il link del tuo canale.",
        });
        return;
      }
      // Save each selected image to the gallery (in selection order).
      let savedCount = 0;
      for (let k = 0; k < selected.length; k++) {
        const b64 = gen.images[selected[k]];
        if (!b64) continue;
        const res = await saveImageToGallery(b64, `dressvibe_${gen.id}_${selected[k]}`);
        if (res.ok) savedCount++;
      }
      try {
        await Clipboard.setStringAsync(gen.title || "Nuovo look DressVibe ✨");
      } catch {}
      // Open the channel so the owner can attach the saved photos.
      try {
        const canOpen = await Linking.canOpenURL(channelUrl);
        if (canOpen) await Linking.openURL(channelUrl);
        else await Linking.openURL(channelUrl.replace("whatsapp.com/channel/", "wa.me/channel/"));
      } catch {}
      const where = Platform.OS === "web" ? "tra i download" : "nella galleria (album \"DressVibe\")";
      await notify({
        title: "Pronto per WhatsApp ✅",
        message:
          `${savedCount} foto salvate ${where}. Nel tuo canale WhatsApp crea un nuovo post e ` +
          `allega le foto (WhatsApp le mostra una alla volta, non come carosello).`,
      });
      exitSelect();
    } catch (e: any) {
      await notify({ title: "Errore WhatsApp", message: e?.message || "Riprova fra qualche istante." });
    } finally {
      setPublishing(false);
    }
  };

  const carouselChannels: PublishChannel[] = [
    ...(chIgFb
      ? [
          { key: "instagram", label: "Instagram", hint: "Carosello automatico", icon: "logo-instagram" as const, color: "#dd2a7b", onPress: () => publishSocial("instagram") },
          { key: "facebook", label: "Facebook", hint: "Carosello automatico", icon: "logo-facebook" as const, color: "#1877F2", onPress: () => publishSocial("facebook") },
        ]
      : []),
    ...(chWa
      ? [{ key: "whatsapp", label: "WhatsApp", hint: "Salva le foto e apre il canale", icon: "logo-whatsapp" as const, color: "#25D366", onPress: publishWhatsApp }]
      : []),
  ];

  const nSel = selected.length;

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(app)"))}
          testID="results-back"
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{gen?.title || "Risultati"}</Text>
        {/* Toggle carousel selection mode */}
        {gen && gen.images.length > 1 ? (
          <TouchableOpacity onPress={() => (selectMode ? exitSelect() : setSelectMode(true))} testID="results-toggle-select">
            <Ionicons name={selectMode ? "close" : "albums-outline"} size={22} color={theme.colors.text} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 24 }} />
        )}
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
          style={s.listFrame}
          contentContainerStyle={{ paddingHorizontal: CONTENT_PADDING, paddingTop: 12, paddingBottom: selectMode ? 120 : 40 }}
          columnWrapperStyle={numColumns > 1 ? { gap: GAP, marginBottom: GAP } : undefined}
          ListHeaderComponent={
            <View>
              {videos.length > 0 && !selectMode ? (
                <View style={s.videosSection}>
                  <Text style={s.videosTitle}>🎬 Video generati ({videos.length})</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 12, paddingRight: 16 }}
                  >
                    {videos.map((v) => (
                      <VideoCard
                        key={v.id}
                        url={v.playback_url || v.video_url}
                        expired={!v.archived}
                        width={videoTileW}
                        height={videoTileH}
                        onDelete={() => handleDeleteVideo(v.id)}
                        onPublish={() =>
                          router.push({
                            pathname: "/studio/[id]",
                            params: { id: gen.id, index: String(v.image_index ?? 0), publishVideoId: v.id },
                          })
                        }
                        onSaveToGallery={async () => {
                          const url = v.playback_url || v.video_url;
                          if (!url) return;
                          const saved = await saveVideoToGallery(url, `dressvibe_${gen.id}_${v.image_index ?? 0}_${v.id || Date.now()}`);
                          if (saved.ok) {
                            const where = saved.where === "gallery" ? "nella galleria del telefono" : "tra i download";
                            notify({ title: "Salvato ✅", message: `Video salvato ${where}.` });
                          } else {
                            notify({ title: "Salvataggio fallito", message: saved.error || "Riprova fra qualche istante." });
                          }
                        }}
                        onOpenStudio={() =>
                          router.push({
                            pathname: "/studio/[id]",
                            params: { id: gen.id, index: String(v.image_index ?? 0) },
                          })
                        }
                      />
                    ))}
                  </ScrollView>
                </View>
              ) : null}
              {/* Prominent carousel entry point — the header "album" icon alone
                  was not discoverable. Preselects all photos. */}
              {!selectMode && gen.images.length > 1 ? (
                <TouchableOpacity
                  style={s.carouselCta}
                  onPress={startCarousel}
                  testID="results-start-carousel"
                  activeOpacity={0.9}
                >
                  <Ionicons name="albums-outline" size={18} color={theme.colors.primaryFg} />
                  <Text style={s.carouselCtaText}>Pubblica come carosello ({gen.images.length} foto)</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={s.hint}>
                {selectMode
                  ? "Tocca le foto per aggiungerle/toglierle · l'ordine dei numeri è l'ordine del carosello · poi «Pubblica»"
                  : `${gen.images.length} variazioni · "Pubblica carosello" sopra, oppure "Pubblica" sotto ogni foto per una singola`}
              </Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const order = selected.indexOf(index); // -1 if not selected
            const isSel = order >= 0;
            if (selectMode) {
              return (
                <TouchableOpacity
                  style={s.tileWrap}
                  activeOpacity={0.85}
                  onPress={() => toggleSelect(index)}
                  testID={`result-select-${index}`}
                >
                  <Image
                    source={{ uri: `data:image/png;base64,${item}` }}
                    style={[s.tile, { width: tileW - 10, height: tileH - 10, opacity: isSel ? 1 : 0.6 }]}
                    resizeMode="contain"
                  />
                  <View style={[s.selBadge, isSel && s.selBadgeOn]}>
                    {isSel ? (
                      <Text style={s.selBadgeText}>{order + 1}</Text>
                    ) : (
                      <Ionicons name="ellipse-outline" size={16} color="#fff" />
                    )}
                  </View>
                </TouchableOpacity>
              );
            }
            return (
              <View style={s.tileWrap}>
                <TouchableOpacity
                  onPress={() => router.push({ pathname: "/studio/[id]", params: { id: gen.id, index: String(index) } })}
                  activeOpacity={0.85}
                  testID={`result-image-${index}`}
                >
                  <Image source={{ uri: `data:image/png;base64,${item}` }} style={[s.tile, { width: tileW - 10, height: tileH - 10 }]} resizeMode="contain" />
                  <View style={s.tileOverlay}>
                    <Ionicons name="brush-outline" size={14} color={theme.colors.text} />
                    <Text style={s.tileText}>Ritocca</Text>
                  </View>
                </TouchableOpacity>
                {/* Azione primaria: pubblica subito senza passare per l'editing.
                    Porta allo Studio già posizionato sulla sezione "Pubblica". */}
                <TouchableOpacity
                  onPress={() => router.push({ pathname: "/studio/[id]", params: { id: gen.id, index: String(index), focus: "publish" } })}
                  style={[s.publishBtn, { width: tileW - 10 }]}
                  testID={`result-publish-${index}`}
                  activeOpacity={0.85}
                >
                  <Ionicons name="paper-plane-outline" size={15} color={theme.colors.primaryFg} />
                  <Text style={s.publishText}>Pubblica</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDeleteImage(index)}
                  style={s.deleteBtn}
                  testID={`result-delete-${index}`}
                  activeOpacity={0.7}
                  hitSlop={8}
                >
                  <Ionicons name="close" size={14} color={theme.colors.text} />
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}

      {/* Carousel action bar */}
      {selectMode && gen && gen.images.length > 0 ? (
        <View style={s.actionBar}>
          <TouchableOpacity
            style={[s.carouselBtn, (nSel === 0 || publishing) && s.carouselBtnDisabled]}
            disabled={nSel === 0 || publishing}
            onPress={() => setPublishOpen(true)}
            testID="results-publish-carousel"
            activeOpacity={0.9}
          >
            {publishing ? (
              <ActivityIndicator color={theme.colors.primaryFg} />
            ) : (
              <>
                <Ionicons name={nSel > 1 ? "albums" : "paper-plane"} size={18} color={theme.colors.primaryFg} />
                <Text style={s.carouselBtnText}>
                  {nSel === 0 ? "Seleziona le foto" : nSel === 1 ? "Pubblica foto" : `Pubblica carosello (${nSel})`}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      <PublishSheet
        visible={publishOpen}
        onClose={() => setPublishOpen(false)}
        channels={carouselChannels}
        subtitle={
          carouselChannels.length === 0
            ? "Nessun canale collegato. Vai in Profilo → Pubblicazione Social."
            : nSel > 1
            ? `Pubblica queste ${nSel} foto come carosello.`
            : "Pubblica questa foto."
        }
      />
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
  headerTitle: { color: theme.colors.text, fontSize: 14, letterSpacing: 1.5, flex: 1, textAlign: "center", marginHorizontal: 8 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 30 },
  emptyTitle: { color: theme.colors.text, fontSize: 16 },
  emptySub: { color: theme.colors.textSecondary, fontSize: 13, textAlign: "center" },
  retry: { marginTop: 8, paddingVertical: 12, paddingHorizontal: 28, backgroundColor: theme.colors.primary, borderRadius: 12 },
  retryText: { color: theme.colors.primaryFg, fontWeight: "600" },
  carouselCta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: theme.colors.primary, paddingVertical: 13, borderRadius: 12,
    marginBottom: 10,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  carouselCtaText: { color: theme.colors.primaryFg, fontSize: 14, fontWeight: "700", letterSpacing: 0.3 },
  hint: { color: theme.colors.textSecondary, fontSize: 11, letterSpacing: 1, marginBottom: 14 },
  videosSection: { marginBottom: 22, gap: 10 },
  videosTitle: { color: theme.colors.text, fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase" },
  tileWrap: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 5,
    shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 6,
  },
  tile: { backgroundColor: theme.colors.surface, borderRadius: 10 },
  listFrame: { width: "100%", maxWidth: 1000, alignSelf: "center" },
  tileOverlay: {
    position: "absolute", bottom: 13, left: 13, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)", paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8,
  },
  tileText: { color: theme.colors.text, fontSize: 10, letterSpacing: 1 },
  publishBtn: {
    marginTop: 6, alignSelf: "center",
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: theme.colors.primary, paddingVertical: 10, borderRadius: 10,
  },
  publishText: { color: theme.colors.primaryFg, fontSize: 13, fontWeight: "700", letterSpacing: 0.4 },
  deleteBtn: {
    position: "absolute", top: 12, right: 12,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.25)",
  },
  // Selection badge (carousel mode)
  selBadge: {
    position: "absolute", top: 12, right: 12,
    minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.5)",
  },
  selBadgeOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  selBadgeText: { color: theme.colors.primaryFg, fontSize: 13, fontWeight: "800" },
  // Bottom action bar
  actionBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: 16, paddingBottom: 26,
    backgroundColor: theme.colors.bg,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
  },
  carouselBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: theme.colors.primary, paddingVertical: 16, borderRadius: 14,
  },
  carouselBtnDisabled: { opacity: 0.5 },
  carouselBtnText: { color: theme.colors.primaryFg, fontSize: 15, fontWeight: "700", letterSpacing: 0.4 },
});
