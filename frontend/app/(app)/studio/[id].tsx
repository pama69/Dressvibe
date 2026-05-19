import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { theme, MAGIC_GRADIENT } from "@/src/theme";
import VideoCard from "@/src/components/VideoCard";
import InstagramShareSheet from "@/src/components/InstagramShareSheet";
import { shareToInstagram, shareGeneric } from "@/src/utils/share";

const QUICK_EDITS = [
  { label: "Rimuovi sfondo", prompt: "Remove the background completely and replace it with a clean white studio background." },
  { label: "Sfondo spiaggia", prompt: "Change the background to a sunny beach at golden hour with soft sea bokeh." },
  { label: "Sfondo strada", prompt: "Change the background to a fashionable European city street with soft bokeh." },
  { label: "Sfondo nero", prompt: "Replace the background with a pure black studio backdrop, cinematic lighting." },
];

export default function Studio() {
  const { id, index } = useLocalSearchParams<{ id: string; index: string }>();
  const router = useRouter();
  const idx = parseInt(index || "0", 10);

  const [image, setImage] = useState<string | null>(null);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [edited, setEdited] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [caption, setCaption] = useState("");
  const [capBusy, setCapBusy] = useState(false);
  const [genTitle, setGenTitle] = useState("");
  const [videoProviders, setVideoProviders] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [tgDescription, setTgDescription] = useState("");
  const [publishingTgVideoId, setPublishingTgVideoId] = useState<string | null>(null);
  const [igSheet, setIgSheet] = useState<{ image?: string; video?: string } | null>(null);

  const loadVideos = useCallback(async () => {
    if (!id) return;
    try {
      const v = await api.listGenerationVideos(id);
      setVideos(v || []);
    } catch (e) {
      // non-fatal
      console.warn("loadVideos", e);
    }
  }, [id]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const g = await api.getGeneration(id);
      const img = g.images?.[idx];
      setImage(img || null);
      setOriginalImage(img || null);
      setGenTitle(g.title || "");
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Errore");
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, idx, router]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadVideos(); }, [loadVideos]);

  useEffect(() => {
    (async () => {
      try {
        const pv = await api.listProviders();
        setVideoProviders(pv.video_gen || []);
      } catch {}
    })();
  }, []);

  const applyEdit = async (prompt: string) => {
    if (!image) return;
    setBusy(true);
    try {
      const res = await api.studioEdit(image, prompt, id);
      setImage(res.image_base64);
      setEdited(true);
    } catch (e: any) {
      Alert.alert("Modifica non riuscita", e?.message || "Riprova");
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateVideo = async (providerId: string) => {
    if (!image) return;
    setVideoBusy(true);
    try {
      const res = await api.createVideo({
        image_base64: image,
        provider: providerId,
        duration_seconds: 5,
        gen_id: id,
        image_index: idx,
      });
      // Optimistically add the new video and refresh from server
      if (res?.video_url) {
        setVideos((prev) => [...prev, res]);
      }
      await loadVideos();
      const msg = "Il tuo video è pronto qui sotto. Premi play per vederlo.";
      if (Platform.OS === "web") window.alert("Video pronto\n\n" + msg); else Alert.alert("Video pronto", msg);
    } catch (e: any) {
      const msg = e?.message || "Errore generazione video";
      if (Platform.OS === "web") window.alert("Errore video\n\n" + msg); else Alert.alert("Errore video", msg);
    } finally {
      setVideoBusy(false);
    }
  };

  const handleDeleteVideo = async (videoId: string) => {
    try {
      await api.deleteVideo(videoId);
      setVideos((prev) => prev.filter((v) => v.id !== videoId));
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile eliminare");
    }
  };

  const handlePublishVideoTelegram = async (video: any) => {
    if (!video?.video_url) return;
    setPublishingTgVideoId(video.id);
    try {
      const captionText =
        tgDescription.trim() ||
        caption?.trim() ||
        "Disponibile in negozio ✨";
      const res = await api.telegramPublish({
        video_url: video.video_url,
        media_type: "video",
        caption: captionText,
        gen_id: id,
        image_index: idx,
      });
      const msg = `Video pubblicato sul canale (id ${res.channel_message_id}).\nQuando un cliente preme "RICHIEDI INFO" riceverai una notifica.`;
      if (Platform.OS === "web") window.alert("Pubblicato su Telegram\n\n" + msg); else Alert.alert("Pubblicato su Telegram", msg);
    } catch (e: any) {
      const m = e?.message || "Impossibile pubblicare il video";
      if (Platform.OS === "web") window.alert("Errore Telegram\n\n" + m); else Alert.alert("Errore Telegram", m);
    } finally {
      setPublishingTgVideoId(null);
    }
  };

  const resetImage = () => { if (originalImage) setImage(originalImage); };

  const generateCaption = async () => {
    setCapBusy(true);
    try {
      const r = await api.caption({
        garment_name: genTitle || "Capo moda",
        category: "outfit",
        style: "instagram",
      });
      setCaption(r.caption);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Errore caption");
    } finally {
      setCapBusy(false);
    }
  };

  const copyCaption = async () => {
    if (!caption) return;
    await Clipboard.setStringAsync(caption);
    Alert.alert("Copiato!", "La caption è negli appunti.");
  };

  const downloadAndShare = async (target: "telegram" | "instagram" | "share") => {
    if (!image) {
      if (Platform.OS === "web" && typeof window !== "undefined") window.alert("Nessuna immagine selezionata");
      return;
    }

    // Publish to the configured Telegram channel with a booking button
    if (target === "telegram") {
      try {
        setBusy(true);
        const captionText =
          tgDescription.trim() ||
          caption?.trim() ||
          "Disponibile in negozio ✨";
        const res = await api.telegramPublish({
          image_base64: image,
          media_type: "photo",
          caption: captionText,
          gen_id: id,
          image_index: idx,
        });
        const msg = `Foto pubblicata sul canale (id ${res.channel_message_id}).\n\nQuando un cliente preme "RICHIEDI INFO" riceverai una notifica.`;
        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.alert("Pubblicato su Telegram\n\n" + msg);
        } else {
          Alert.alert("Pubblicato su Telegram", msg);
        }
      } catch (e: any) {
        const errMsg = e?.message || "Impossibile pubblicare";
        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.alert("Errore Telegram\n\n" + errMsg);
        } else {
          Alert.alert("Errore Telegram", errMsg);
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      const opts = {
        imageBase64: image,
        caption: caption?.trim() || undefined,
        fileBaseName: `dressvibe_${id}_${idx}`,
      };
      if (target === "instagram") {
        await shareToInstagram(opts);
      } else {
        await shareGeneric(opts);
      }
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile condividere");
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} testID="studio-back">
            <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Studio</Text>
          <TouchableOpacity onPress={resetImage} testID="studio-reset">
            <Ionicons name="refresh-outline" size={20} color={theme.colors.text} />
          </TouchableOpacity>
        </View>

        {edited ? (
          <View style={s.editedBanner} testID="studio-edited-banner">
            <Ionicons name="checkmark-circle" size={14} color={theme.colors.success} />
            <Text style={s.editedText}>
              Modifica salvata nella galleria di questa generazione
            </Text>
          </View>
        ) : null}

        <ScrollView contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
          <View style={s.imageWrap}>
            {loading || !image ? (
              <View style={s.imagePh}><ActivityIndicator color={theme.colors.text} /></View>
            ) : (
              <Image source={{ uri: `data:image/png;base64,${image}` }} style={s.image} />
            )}
            {busy && (
              <View style={s.busyOverlay}>
                <ActivityIndicator color="#fff" />
                <Text style={s.busyText}>Applicazione modifica…</Text>
              </View>
            )}
          </View>

          {/* Quick edits */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Modifiche rapide</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
              {QUICK_EDITS.map((q) => (
                <TouchableOpacity
                  key={q.label}
                  onPress={() => applyEdit(q.prompt)}
                  disabled={busy}
                  style={s.quickChip}
                  testID={`quick-${q.label}`}
                >
                  <Text style={s.quickText}>{q.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Custom edit */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Modifica personalizzata</Text>
            <TextInput
              value={editPrompt} onChangeText={setEditPrompt}
              placeholder="es. Aggiungi il prezzo €49 in alto a sinistra"
              placeholderTextColor={theme.colors.textMuted}
              style={s.input}
              testID="studio-prompt"
              multiline
            />
            <TouchableOpacity
              onPress={() => editPrompt && applyEdit(editPrompt)}
              disabled={!editPrompt || busy}
              activeOpacity={0.85}
              testID="studio-apply"
            >
              <LinearGradient
                colors={MAGIC_GRADIENT}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={[s.applyBtn, (!editPrompt || busy) && { opacity: 0.45 }]}
              >
                <Ionicons name="sparkles" size={16} color="#fff" />
                <Text style={s.applyText}>Applica modifica</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Caption */}
          <View style={s.section}>
            <View style={s.sectionHead}>
              <Text style={s.sectionLabel}>Caption Instagram</Text>
              <TouchableOpacity onPress={generateCaption} disabled={capBusy} testID="caption-generate">
                <Text style={s.captionGen}>
                  {capBusy ? "Generazione…" : "✨ Genera"}
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              value={caption} onChangeText={setCaption} multiline
              placeholder="La tua caption apparirà qui…"
              placeholderTextColor={theme.colors.textMuted}
              style={[s.input, { minHeight: 90, textAlignVertical: "top" }]}
              testID="caption-input"
            />
            {caption ? (
              <TouchableOpacity onPress={copyCaption} style={s.copyBtn} testID="caption-copy">
                <Ionicons name="copy-outline" size={14} color={theme.colors.text} />
                <Text style={s.copyText}>Copia caption</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Genera Video */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>🎬 Genera Video</Text>
            <Text style={s.videoHint}>
              Crea una clip 9:16 da questa foto: la modella gira su se stessa, cammina, mostra l'outfit. ~60–120 secondi di attesa.
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
              {videoProviders.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => handleGenerateVideo(p.id)}
                  disabled={!p.enabled || videoBusy}
                  style={[s.videoBtn, (!p.enabled || videoBusy) && { opacity: 0.45 }]}
                  testID={`video-${p.id}`}
                >
                  <Text style={s.videoBtnName}>{p.name}</Text>
                  <Text style={s.videoBtnSub}>
                    {p.enabled ? "✨ Pronto" : `🔒 ${p.missing_keys?.join(", ")}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {videoBusy ? (
              <View style={s.videoBusy} testID="video-busy">
                <ActivityIndicator color={theme.colors.text} />
                <Text style={s.videoBusyText}>Sto generando il video… può richiedere 1–3 minuti</Text>
              </View>
            ) : null}

            {videos.length > 0 ? (
              <View style={{ gap: 18, marginTop: 4 }} testID="video-list">
                <Text style={s.videoListLabel}>I tuoi video ({videos.length})</Text>
                {videos.map((v) => (
                  <VideoCard
                    key={v.id}
                    url={v.playback_url || v.video_url}
                    expired={!v.archived}
                    width={300}
                    height={Math.round(300 * (16 / 9))}
                    onDelete={() => handleDeleteVideo(v.id)}
                    onPublishTelegram={() => handlePublishVideoTelegram(v)}
                    publishingTelegram={publishingTgVideoId === v.id}
                    onShare={() => setIgSheet({ video: v.playback_url || v.video_url })}
                  />
                ))}
              </View>
            ) : null}
          </View>

          {/* Descrizione del post */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>📝 Descrizione del post Telegram</Text>
            <Text style={s.tgHint}>
              Questo testo apparirà sotto la foto/video pubblicata sul canale. Se vuoto, useremo la caption Instagram o un testo di default.
            </Text>
            <TextInput
              value={tgDescription}
              onChangeText={setTgDescription}
              multiline
              placeholder="es. Nuovo arrivo — Maglione Cashmere · €189 · Tg S/M/L · Disponibile in negozio o spedizione gratuita"
              placeholderTextColor={theme.colors.textMuted}
              style={[s.input, { minHeight: 90, textAlignVertical: "top" }]}
              testID="tg-description-input"
              maxLength={1000}
            />
            <Text style={s.tgCounter}>{tgDescription.length}/1000</Text>
          </View>

          {/* Share */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Condividi</Text>
            <View style={s.shareRow}>
              <TouchableOpacity style={[s.shareBtn, busy && { opacity: 0.6 }]} onPress={() => downloadAndShare("telegram")} testID="share-telegram" disabled={busy} activeOpacity={0.7}>
                <Ionicons name="paper-plane-outline" size={20} color={theme.colors.text} />
                <Text style={s.shareLabel}>🚀 PUBBLICA TG</Text>
                <Text style={s.shareSub}>con "Prenota"</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.shareBtn} onPress={() => image && setIgSheet({ image })} testID="share-instagram">
                <Ionicons name="logo-instagram" size={20} color={theme.colors.text} />
                <Text style={s.shareLabel}>Instagram</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.shareBtn} onPress={() => downloadAndShare("share")} testID="share-download">
                <Ionicons name="download-outline" size={20} color={theme.colors.text} />
                <Text style={s.shareLabel}>Scarica HD</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <InstagramShareSheet
        visible={!!igSheet}
        onClose={() => setIgSheet(null)}
        imageBase64={igSheet?.image}
        videoUrl={igSheet?.video}
        genId={id}
        imageIndex={idx}
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
  headerTitle: { color: theme.colors.text, fontSize: 14, letterSpacing: 2, textTransform: "uppercase" },
  imageWrap: {
    marginTop: 16, aspectRatio: 9 / 16, backgroundColor: theme.colors.surface, position: "relative",
    alignSelf: "center", width: "100%", maxWidth: 380,
  },
  imagePh: { flex: 1, alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center", gap: 10,
  },
  busyText: { color: "#fff", fontSize: 12, letterSpacing: 1 },
  section: { paddingHorizontal: 24, marginTop: 24, gap: 10 },
  sectionLabel: { color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 2, textTransform: "uppercase" },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  captionGen: { color: theme.colors.text, fontSize: 12, fontWeight: "500" },
  quickChip: {
    paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
  },
  quickText: { color: theme.colors.text, fontSize: 12 },
  input: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    color: theme.colors.text, padding: 14, fontSize: 14, minHeight: 60,
  },
  applyBtn: {
    paddingVertical: 14, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10,
  },
  applyText: { color: "#fff", fontWeight: "700", letterSpacing: 0.4 },
  copyBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.colors.border,
  },
  copyText: { color: theme.colors.text, fontSize: 12 },
  shareRow: { flexDirection: "row", gap: 10 },
  shareBtn: {
    flex: 1, alignItems: "center", paddingVertical: 18, gap: 6,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
  },
  shareLabel: { color: theme.colors.text, fontSize: 11, letterSpacing: 0.6, textAlign: "center" },
  shareSub: { color: theme.colors.textMuted, fontSize: 9, textAlign: "center" },
  videoHint: { color: theme.colors.textSecondary, fontSize: 11, lineHeight: 16, marginBottom: 4 },
  videoBtn: {
    paddingVertical: 14, paddingHorizontal: 18, borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, minWidth: 160, gap: 4,
  },
  videoBtnName: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  videoBtnSub: { color: theme.colors.textSecondary, fontSize: 10 },
  videoBusy: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 14, borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  videoBusyText: { color: theme.colors.textSecondary, fontSize: 12, flex: 1 },
  videoListLabel: {
    color: theme.colors.text, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase",
  },
  editedBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 24, marginTop: 12, padding: 10,
    borderWidth: 1, borderColor: theme.colors.success,
    backgroundColor: "rgba(16,185,129,0.08)",
  },
  editedText: { color: theme.colors.success, fontSize: 12, flex: 1 },
});

s, fontSize: 12, flex: 1 },
});

