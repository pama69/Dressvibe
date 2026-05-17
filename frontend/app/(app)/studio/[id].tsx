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
  Share,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { theme, MAGIC_GRADIENT } from "@/src/theme";

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
    if (Platform.OS === "web" && typeof window !== "undefined") {
      console.log("[DressVibe] downloadAndShare CALLED. target=", target);
    }
    if (!image) {
      if (Platform.OS === "web" && typeof window !== "undefined") window.alert("Nessuna immagine selezionata");
      return;
    }

    // Publish to the configured Telegram channel with a booking button
    if (target === "telegram") {
      try {
        setBusy(true);
        const captionText = caption?.trim() || genTitle || "Disponibile in negozio ✨";
        console.log("[DressVibe] Calling api.telegramPublish, caption length:", captionText.length, "img len:", image.length);
        const res = await api.telegramPublish({
          image_base64: image,
          caption: captionText,
          gen_id: id,
          image_index: idx,
        });
        console.log("[DressVibe] Publish OK:", res);
        const msg = `Foto pubblicata sul canale (id ${res.channel_message_id}).\n\nQuando un cliente preme "PRENOTA IL TUO CAPO ORA!" riceverai una notifica.`;
        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.alert("Pubblicato su Telegram\n\n" + msg);
        } else {
          Alert.alert("Pubblicato su Telegram", msg);
        }
      } catch (e: any) {
        console.error("[DressVibe] Publish error:", e);
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
      if (Platform.OS === "web") {
        const link = document.createElement("a");
        link.href = `data:image/png;base64,${image}`;
        link.download = `dressvibe_${id}_${idx}.png`;
        link.click();
        if (caption) await Clipboard.setStringAsync(caption);
        Alert.alert(
          "Immagine scaricata",
          caption
            ? "La caption è stata copiata. Incollala nella tua app preferita."
            : "Pronto a condividere!"
        );
        return;
      }
      const path = `${FileSystem.cacheDirectory}dressvibe_${id}_${idx}.png`;
      await FileSystem.writeAsStringAsync(path, image, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (caption) await Clipboard.setStringAsync(caption);

      const ok = await Sharing.isAvailableAsync();
      if (ok) {
        await Sharing.shareAsync(path, {
          dialogTitle: target === "instagram" ? "Pubblica su Instagram" : "Condividi outfit DressVibe",
        });
      } else {
        await Share.share({ url: path, message: caption || "Da DressVibe" });
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

          {/* Share */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Condividi</Text>
            <View style={s.shareRow}>
              <TouchableOpacity style={[s.shareBtn, busy && { opacity: 0.6 }]} onPress={() => downloadAndShare("telegram")} testID="share-telegram" disabled={busy} activeOpacity={0.7}>
                <Ionicons name="paper-plane-outline" size={20} color={theme.colors.text} />
                <Text style={s.shareLabel}>🚀 PUBBLICA TG</Text>
                <Text style={s.shareSub}>con "Prenota"</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.shareBtn} onPress={() => downloadAndShare("instagram")} testID="share-instagram">
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
  editedBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 24, marginTop: 12, padding: 10,
    borderWidth: 1, borderColor: theme.colors.success,
    backgroundColor: "rgba(16,185,129,0.08)",
  },
  editedText: { color: theme.colors.success, fontSize: 12, flex: 1 },
});
