/**
 * Instagram Share Sheet — opens a modal with an AI-generated caption that the user
 * can edit/regenerate, then saves the media to the device gallery and copies the
 * caption to the clipboard, finally deep-linking to Instagram (if installed).
 *
 * Works for BOTH photos (base64 PNG) and videos (remote mp4 URL).
 *
 * Web fallback: downloads the file via a temporary <a> link and copies caption.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";

type Style = "elegante" | "friendly" | "minimal" | "trendy";

type Props = {
  visible: boolean;
  onClose: () => void;
  // either an image (base64 png) OR a video (remote url) — never both
  imageBase64?: string;
  videoUrl?: string;
  genId?: string;
  imageIndex?: number;
  shopName?: string;
  city?: string;
  /** When true, the modal will NOT re-save the media to gallery — used when
   * the caller (e.g. the Studio screen) has already saved the image to the
   * gallery before opening the modal. */
  skipSave?: boolean;
  /** Unified "Testo del post" from the Studio. When provided (non-empty) the
   * sheet uses it as-is instead of auto-generating a separate caption, so the
   * text stays coherent across all channels. The user can still regenerate. */
  initialCaption?: string;
};

const STYLE_LABELS: { id: Style; label: string; emoji: string }[] = [
  { id: "elegante", label: "Elegante", emoji: "✨" },
  { id: "friendly", label: "Friendly", emoji: "💛" },
  { id: "minimal", label: "Minimal", emoji: "◻️" },
  { id: "trendy", label: "Trendy", emoji: "🔥" },
];

function notify(title: string, msg?: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.alert(msg ? `${title}\n\n${msg}` : title);
  } else {
    Alert.alert(title, msg);
  }
}

export default function InstagramShareSheet({
  visible,
  onClose,
  imageBase64,
  videoUrl,
  genId,
  imageIndex,
  shopName = "Frammenti",
  city = "Pescara",
  skipSave = false,
  initialCaption = "",
}: Props) {
  const mediaType: "photo" | "video" = videoUrl ? "video" : "photo";
  const [style, setStyle] = useState<Style>("elegante");
  const [caption, setCaption] = useState<string>("");
  const [extraHint, setExtraHint] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [touched, setTouched] = useState(false);

  const fetchCaption = useCallback(
    async (nextStyle: Style, hint?: string) => {
      setGenerating(true);
      try {
        const res = await api.generateInstagramCaption({
          gen_id: genId,
          image_index: imageIndex,
          media_type: mediaType,
          style: nextStyle,
          shop_name: shopName,
          city,
          extra_hint: hint?.trim() || undefined,
        });
        setCaption(res.caption);
        setTouched(false);
      } catch (e: any) {
        notify("Errore caption", e?.message || "Impossibile generare la caption");
      } finally {
        setGenerating(false);
      }
    },
    [genId, imageIndex, mediaType, shopName, city],
  );

  useEffect(() => {
    if (!visible || caption) return;
    // Prefer the unified "Testo del post" coming from the Studio. Only fall
    // back to auto-generating a fresh caption when it's empty.
    if (initialCaption.trim()) {
      setCaption(initialCaption.trim());
    } else {
      fetchCaption(style);
    }
  }, [visible, caption, fetchCaption, style, initialCaption]);

  const changeStyle = (s: Style) => {
    setStyle(s);
    if (!touched) {
      // No user edits → just regenerate. If user already edited, ask first.
      fetchCaption(s, extraHint);
    } else {
      Alert.alert?.(
        "Sovrascrivere?",
        "Hai modificato la caption. Vuoi rigenerare nello stile selezionato?",
        [
          { text: "No", style: "cancel" },
          { text: "Rigenera", onPress: () => fetchCaption(s, extraHint) },
        ],
      ) ?? fetchCaption(s, extraHint);
    }
  };

  const saveAndOpenInstagram = async () => {
    if (!caption?.trim()) { notify("La caption è vuota"); return; }
    setBusy(true);
    try {
      // 1. Copy caption to clipboard
      await Clipboard.setStringAsync(caption);

      if (Platform.OS === "web") {
        // Web fallback: download the file via temp link and show instructions.
        // We intentionally do NOT auto-open instagram.com here because:
        //   - Instagram sends Cross-Origin-Opener-Policy: same-origin which,
        //     combined with the preview iframe context, triggers
        //     ERR_BLOCKED_BY_RESPONSE in Chrome.
        //   - On desktop Instagram you can't post anyway (no "+" upload UI).
        // The user can open Instagram manually from their phone — most likely
        // the real flow they want when posting fashion content.
        const filename = mediaType === "video" ? `dressvibe_${genId || "clip"}.mp4` : `dressvibe_${genId || "img"}.png`;
        if (mediaType === "photo" && imageBase64) {
          const a = document.createElement("a");
          a.href = `data:image/png;base64,${imageBase64}`;
          a.download = filename;
          a.rel = "noopener noreferrer";
          document.body.appendChild(a);
          a.click();
          a.remove();
        } else if (mediaType === "video" && videoUrl) {
          const a = document.createElement("a");
          a.href = videoUrl;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
        notify(
          "Pronto per Instagram ✅",
          (mediaType === "video"
            ? "Video scaricato sul PC."
            : "Foto scaricata sul PC.") +
            "\nCaption copiata negli appunti.\n\n" +
            "Per pubblicare: trasferisci il file sul telefono (AirDrop / Drive / WhatsApp Web a te stesso) → apri Instagram dall'app → incolla la caption.",
        );
        return;
      }

      // 2. Save media to device gallery (native) — skipped for photos if the
      // caller has already saved them (avoids creating duplicate gallery items).
      if (skipSave && mediaType === "photo") {
        // No save needed; just deep-link to Instagram. We don't have a localUri
        // so we go straight to the deep-link step.
      } else {
        const perm = await MediaLibrary.requestPermissionsAsync(true);
        if (perm.status !== "granted") {
          notify("Permesso negato", "Per salvare nella galleria devi concedere il permesso a DressVibe.");
          return;
        }

        let localUri: string | null = null;
        if (mediaType === "photo" && imageBase64) {
          const path = `${FileSystem.cacheDirectory}dressvibe_${genId || "img"}_${Date.now()}.png`;
          await FileSystem.writeAsStringAsync(path, imageBase64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          localUri = path;
        } else if (mediaType === "video" && videoUrl) {
          const path = `${FileSystem.cacheDirectory}dressvibe_${genId || "clip"}_${Date.now()}.mp4`;
          const dl = await FileSystem.downloadAsync(videoUrl, path);
          if (dl.status !== 200) {
            throw new Error(`Download video fallito (${dl.status})`);
          }
          localUri = dl.uri;
        }

        if (!localUri) throw new Error("Nessun media da salvare");

        const asset = await MediaLibrary.createAssetAsync(localUri);
        try {
          const album = await MediaLibrary.getAlbumAsync("DressVibe");
          if (album) {
            await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
          } else {
            await MediaLibrary.createAlbumAsync("DressVibe", asset, false);
          }
        } catch (e) {
          // Album creation may fail on some Android versions, but asset is already saved
          console.warn("album save failed", e);
        }
      }

      // 3. Try to open Instagram app
      const instagramUrl = "instagram://library";
      try {
        const can = await Linking.canOpenURL(instagramUrl);
        if (can) {
          await Linking.openURL(instagramUrl);
        } else {
          await Linking.openURL("https://www.instagram.com/");
        }
      } catch {
        try { await Linking.openURL("https://www.instagram.com/"); } catch {}
      }

      notify(
        "Pronto da pubblicare ✅",
        `${mediaType === "video" ? "Il video" : "La foto"} è stata salvata nella tua galleria (album DressVibe) e la caption è negli appunti.\n\nIn Instagram tocca "+" → scegli il media dalla galleria → tieni premuto sul campo caption → "Incolla".`,
      );

      onClose();
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile preparare il post");
    } finally {
      setBusy(false);
    }
  };

  const copyOnly = async () => {
    await Clipboard.setStringAsync(caption || "");
    notify("Caption copiata 📋");
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false} presentationStyle="formSheet">
      <View style={s.container}>
        <View style={s.header}>
          <Text style={s.title}>📸 Post Instagram</Text>
          <TouchableOpacity onPress={onClose} testID="ig-sheet-close">
            <Ionicons name="close" size={26} color={theme.colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <Text style={s.sub}>
            {shopName} · {city} · {mediaType === "video" ? "Reel 9:16" : "Foto"}
          </Text>

          {/* Style chips */}
          <Text style={s.label}>Stile caption</Text>
          <View style={s.chips}>
            {STYLE_LABELS.map((sl) => {
              const active = style === sl.id;
              return (
                <TouchableOpacity
                  key={sl.id}
                  onPress={() => changeStyle(sl.id)}
                  style={[s.chip, active && s.chipActive]}
                  disabled={generating}
                  testID={`ig-style-${sl.id}`}
                >
                  <Text style={[s.chipText, active && s.chipTextActive]}>{sl.emoji} {sl.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Extra hint */}
          <Text style={s.label}>Indizio extra (opzionale)</Text>
          <TextInput
            value={extraHint}
            onChangeText={setExtraHint}
            placeholder="es. nuova collezione P/E · saldi -30% · cashmere · evento sabato"
            placeholderTextColor={theme.colors.textMuted}
            style={s.input}
            maxLength={120}
            testID="ig-extra-hint"
          />

          {/* Caption editor */}
          <View style={s.captionHead}>
            <Text style={s.label}>Caption ({caption.length}/2200)</Text>
            <TouchableOpacity
              onPress={() => fetchCaption(style, extraHint)}
              disabled={generating}
              style={s.regen}
              testID="ig-regen"
            >
              {generating ? (
                <ActivityIndicator size="small" color={theme.colors.text} />
              ) : (
                <>
                  <Ionicons name="refresh" size={14} color={theme.colors.text} />
                  <Text style={s.regenText}>Rigenera</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          <TextInput
            value={caption}
            onChangeText={(t) => { setCaption(t); setTouched(true); }}
            multiline
            style={[s.input, s.captionInput]}
            placeholder={generating ? "L'AI sta scrivendo…" : "La caption apparirà qui"}
            placeholderTextColor={theme.colors.textMuted}
            maxLength={2200}
            textAlignVertical="top"
            testID="ig-caption-input"
          />

          {/* Helper */}
          <Text style={s.helper}>
            ✦ Premi "Pubblica su Instagram":{"\n"}
            1. {mediaType === "video" ? "Il video" : "La foto"} viene salvata nella galleria del telefono (album DressVibe){"\n"}
            2. La caption viene copiata negli appunti{"\n"}
            3. Si apre Instagram → tocca "+", scegli il media, incolla la caption
          </Text>
        </ScrollView>

        {/* Footer buttons */}
        <View style={s.footer}>
          <TouchableOpacity style={s.copyBtn} onPress={copyOnly} disabled={busy || generating} testID="ig-copy">
            <Ionicons name="copy-outline" size={16} color={theme.colors.text} />
            <Text style={s.copyText}>Copia caption</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.cta, (busy || generating || !caption.trim()) && { opacity: 0.5 }]}
            onPress={saveAndOpenInstagram}
            disabled={busy || generating || !caption.trim()}
            testID="ig-save-open"
          >
            <LinearGradient
              colors={["#f58529", "#dd2a7b", "#8134af"]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={s.ctaInner}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="logo-instagram" size={18} color="#fff" />
                  <Text style={s.ctaText}>Pubblica su Instagram</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  title: { color: theme.colors.text, fontSize: 16, fontWeight: "600" },
  scroll: { padding: 20, gap: 8, paddingBottom: 30 },
  sub: { color: theme.colors.textSecondary, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" },
  label: { color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", marginTop: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  chipText: { color: theme.colors.text, fontSize: 12 },
  chipTextActive: { color: "#000", fontWeight: "700" },
  input: {
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
    paddingHorizontal: 14, paddingVertical: 12, color: theme.colors.text, fontSize: 14,
  },
  captionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  regen: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 6, paddingHorizontal: 10,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  regenText: { color: theme.colors.text, fontSize: 11 },
  captionInput: { minHeight: 220, lineHeight: 20 },
  helper: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 16 },
  footer: {
    flexDirection: "row", gap: 10, padding: 16,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
  },
  copyBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  copyText: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  cta: { flex: 1 },
  ctaInner: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  ctaText: { color: "#fff", fontWeight: "700", letterSpacing: 0.5 },
});
