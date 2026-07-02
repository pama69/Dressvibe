import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, Linking, ActivityIndicator } from "react-native";
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
  /** Opens the unified publish sheet (same "Pubblica" flow as photos) scoped
   *  to this video — see PublishSheet. */
  onPublish?: () => void;
  publishing?: boolean;
  onSaveToGallery?: () => Promise<void> | void;
  onOpenStudio?: () => void;
  showActions?: boolean;
};

export default function VideoCard({
  url,
  width,
  height,
  expired,
  onDelete,
  onPublish,
  publishing,
  onSaveToGallery,
  onOpenStudio,
  showActions = true,
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
          {/* Unico punto d'ingresso di pubblicazione — stesso "Pubblica" +
              foglio canali usato per le foto, invece dei 3 pulsanti fissi
              di prima (che ignoravano se un canale fosse configurato). */}
          {onPublish ? (
            <TouchableOpacity
              onPress={onPublish}
              disabled={publishing}
              style={[s.publishBtn, publishing && s.busy]}
              testID="video-publish"
              activeOpacity={0.85}
            >
              {publishing ? (
                <ActivityIndicator color={theme.colors.primaryFg} size="small" />
              ) : (
                <>
                  <Ionicons name="paper-plane" size={16} color={theme.colors.primaryFg} />
                  <Text style={s.publishBtnText}>Pubblica</Text>
                </>
              )}
            </TouchableOpacity>
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

  // Unified "Pubblica" CTA — same visual weight as the photo publish button.
  publishBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: theme.colors.primary,
    minHeight: 44,
  },
  publishBtnText: { color: theme.colors.primaryFg, fontSize: 14, fontWeight: "700", letterSpacing: 0.3 },

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
