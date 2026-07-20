import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { Button, PhotoFrame, type as noirType } from "@/src/components/noir";
import { useConfirm } from "@/src/contexts/ConfirmContext";
import VideoCard from "@/src/components/VideoCard";
import { saveVideoToGallery } from "@/src/utils/gallery";
import { useNotify } from "@/src/contexts/ConfirmContext";

const GAP = 12;
const CONTENT_PADDING = 20;

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
  const { width: winW } = useWindowDimensions();
  const tileW = Math.floor((winW - CONTENT_PADDING * 2 - GAP) / 2);
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

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(app)"))}
          testID="results-back"
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.textSecondary} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={noirType.eyebrow}>RISULTATI</Text>
          <Text style={s.headerTitle} numberOfLines={1}>{gen?.title || "Risultati"}</Text>
        </View>
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
        <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
          {videos.length > 0 ? (
            <View style={s.videosSection}>
              <Text style={noirType.h2}>🎬 Video · {videos.length}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 12, paddingRight: 16, marginTop: 12 }}
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

          <Text style={[noirType.h2, s.gridTitle]}>{gen.images.length} variazioni</Text>
          <View style={s.grid}>
            {gen.images.map((item, index) => (
              <View key={index} style={{ width: tileW }}>
                <TouchableOpacity
                  onPress={() => router.push({ pathname: "/studio/[id]", params: { id: gen.id, index: String(index) } })}
                  activeOpacity={0.85}
                  testID={`result-image-${index}`}
                >
                  <PhotoFrame
                    source={{ uri: `data:image/png;base64,${item}` }}
                    style={{ height: 216 }}
                    onRemove={() => handleDeleteImage(index)}
                  >
                    <View style={s.ritoccaPill} pointerEvents="none">
                      <Ionicons name="brush-outline" size={11} color={theme.colors.text} />
                      <Text style={s.ritoccaText}>Ritocca</Text>
                    </View>
                  </PhotoFrame>
                </TouchableOpacity>
                <Button
                  variant="grad"
                  small
                  style={s.publishBtn}
                  onPress={() => router.push({ pathname: "/studio/[id]", params: { id: gen.id, index: String(index), focus: "publish" } })}
                >
                  ✦ Pubblica
                </Button>
              </View>
            ))}
          </View>
        </ScrollView>
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
  headerCenter: { alignItems: "center", gap: 4 },
  headerTitle: { fontFamily: theme.font.serif, fontSize: 17, color: theme.colors.text, maxWidth: 220 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 30 },
  emptyTitle: { color: theme.colors.text, fontSize: 16 },
  emptySub: { color: theme.colors.textSecondary, fontSize: 13, textAlign: "center" },
  retry: { marginTop: 8, paddingVertical: 12, paddingHorizontal: 28, backgroundColor: theme.colors.primary, borderRadius: 12 },
  retryText: { color: theme.colors.primaryFg, fontWeight: "600" },
  scrollContent: { paddingHorizontal: CONTENT_PADDING, paddingTop: 16, paddingBottom: 40 },
  videosSection: { marginBottom: 26 },
  gridTitle: { marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  ritoccaPill: {
    position: "absolute", right: 10, bottom: 10,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.pill, paddingHorizontal: 8, paddingVertical: 4,
  },
  ritoccaText: { color: theme.colors.text, fontSize: 10, letterSpacing: 0.4 },
  publishBtn: { marginTop: 8, width: "100%" },
});
