import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import * as Clipboard from "expo-clipboard";
import { theme } from "@/src/theme";

type Props = {
  url: string;
  width: number;
  height: number;
  expired?: boolean;
  onDelete?: () => void;
  onShareInstagram?: () => void;
  onShareWhatsApp?: () => void;
  onPublishTelegram?: () => void;
  publishingTelegram?: boolean;
  publishingWhatsApp?: boolean;
  onSaveToGallery?: () => Promise<void> | void;
  onOpenStudio?: () => void;
  showActions?: boolean;
  // Legacy alias — some screens still pass `onShare` (Instagram share). Keep
  // it for backward compatibility.
  onShare?: () => void;
};

export default function VideoCard({
  url,
  width,
  height,
  expired,
  onDelete,
  onShareInstagram,
  onShareWhatsApp,
  onPublishTelegram,
  publishingTelegram,
  publishingWhatsApp,
  onSaveToGallery,
  onOpenStudio,
  showActions = true,
  onShare,
}: Props) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = true;
  });
  const [savingLocal, setSavingLocal] = useState(false);

  useEffect(() => {
    return () => {
      try { player.pause(); } catch {}
    };
  }, [player]);

  // Backward compat: if only `onShare` (legacy) was passed, treat it as IG.
  const igHandler = onShareInstagram || onShare;

  const handleCopyLink = async () => {
    try { await Clipboard.setStringAsync(url); } catch {}
  };

  const handleSave = async () => {
    if (!onSaveToGallery || savingLocal) return;
    setSavingLocal(true);
    try { await onSaveToGallery(); } finally { setSavingLocal(false); }
  };

  const handleOpenExternal = async () => {
    if (Platform.OS === "web") {
      try { window.open(url, "_blank"); } catch {}
    } else {
      try { await Linking.openURL(url); } catch {}
    }
  };

  return (
    <View style={[s.wrap, { width }]}>
      <View style={[s.player, { width, height }]}>
        {expired ? (
          <View style={s.expired}>
            <Ionicons name="cloud-offline-outline" size={32} color={theme.colors.textMuted} />
            <Text style={s.expiredTitle}>Video non più disponibile</Text>
            <Text style={s.expiredSub}>
              Il link del provider è scaduto. I nuovi video vengono archiviati automaticamente;
              questo è stato generato prima della fix.
            </Text>
          </View>
        ) : (
          <VideoView
            player={player}
            style={{ width, height }}
            contentFit="cover"
            nativeControls
            allowsFullscreen
            allowsPictureInPicture
          />
        )}
      </View>

      {showActions ? (
        <View style={s.actionsWrap}>
          {/* PRIMARY: 3 share buttons, equal width, colour-coded */}
          {(onShareWhatsApp || onPublishTelegram || igHandler) ? (
            <View style={s.shareRow}>
              {onShareWhatsApp ? (
                <TouchableOpacity
                  onPress={onShareWhatsApp}
                  disabled={publishingWhatsApp}
                  style={[s.shareBtn, s.waBtn, publishingWhatsApp && s.busy]}
                  testID="video-share-wa"
                  activeOpacity={0.85}
                >
                  <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
                  <Text style={[s.shareLabel, { color: "#25D366" }]}>
                    {publishingWhatsApp ? "Apro…" : "WhatsApp"}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {onPublishTelegram ? (
                <TouchableOpacity
                  onPress={onPublishTelegram}
                  disabled={publishingTelegram}
                  style={[s.shareBtn, s.tgBtn, publishingTelegram && s.busy]}
                  testID="video-publish-tg"
                  activeOpacity={0.85}
                >
                  <Ionicons name="paper-plane" size={16} color="#2AABEE" />
                  <Text style={[s.shareLabel, { color: "#2AABEE" }]}>
                    {publishingTelegram ? "Invio…" : "Telegram"}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {igHandler ? (
                <TouchableOpacity
                  onPress={igHandler}
                  style={[s.shareBtn, s.igBtn]}
                  testID="video-share-ig"
                  activeOpacity={0.85}
                >
                  <Ionicons name="logo-instagram" size={18} color="#dd2a7b" />
                  <Text style={[s.shareLabel, { color: "#dd2a7b" }]}>Instagram</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {/* SECONDARY: utility chips — only render when at least one is present */}
          {(onOpenStudio || onSaveToGallery || onDelete) ? (
            <View style={s.utilRow}>
              {onOpenStudio ? (
                <TouchableOpacity
                  onPress={onOpenStudio}
                  style={s.utilBtn}
                  testID="video-open-studio"
                  activeOpacity={0.7}
                >
                  <Ionicons name="brush-outline" size={13} color={theme.colors.text} />
                  <Text style={s.utilText}>Studio</Text>
                </TouchableOpacity>
              ) : null}
              {onSaveToGallery ? (
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={savingLocal}
                  style={[s.utilBtn, savingLocal && s.busy]}
                  testID="video-save"
                  activeOpacity={0.7}
                >
                  <Ionicons name="download-outline" size={13} color={theme.colors.text} />
                  <Text style={s.utilText}>{savingLocal ? "Salvo…" : "Salva"}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity onPress={handleCopyLink} style={s.utilBtn} testID="video-copy" activeOpacity={0.7}>
                <Ionicons name="link-outline" size={13} color={theme.colors.text} />
                <Text style={s.utilText}>Link</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleOpenExternal} style={s.utilBtn} testID="video-open" activeOpacity={0.7}>
                <Ionicons name="open-outline" size={13} color={theme.colors.text} />
                <Text style={s.utilText}>Apri</Text>
              </TouchableOpacity>
              {onDelete ? (
                <TouchableOpacity
                  onPress={onDelete}
                  style={[s.utilBtn, s.dangerBtn]}
                  testID="video-delete"
                  activeOpacity={0.7}
                  hitSlop={6}
                >
                  <Ionicons name="trash-outline" size={13} color={theme.colors.error} />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10 },
  player: {
    backgroundColor: "#000",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionsWrap: { gap: 8 },

  // Primary share row — 3 equal-width buttons, colour-coded
  shareRow: { flexDirection: "row", gap: 8 },
  shareBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderRadius: 4,
    minHeight: 44,
  },
  shareLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.3 },
  waBtn: { borderColor: "#25D366", backgroundColor: "rgba(37,211,102,0.10)" },
  tgBtn: { borderColor: "#2AABEE", backgroundColor: "rgba(42,171,238,0.12)" },
  igBtn: { borderColor: "#dd2a7b", backgroundColor: "rgba(221,42,123,0.10)" },

  // Utility row — smaller chips, neutral colour
  utilRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  utilBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    minHeight: 32,
  },
  utilText: { color: theme.colors.text, fontSize: 11 },
  dangerBtn: { borderColor: theme.colors.error, paddingHorizontal: 8 },

  busy: { opacity: 0.5 },

  expired: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 8,
    paddingHorizontal: 18,
  },
  expiredTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  expiredSub: { color: theme.colors.textMuted, fontSize: 11, textAlign: "center", lineHeight: 16 },
});
