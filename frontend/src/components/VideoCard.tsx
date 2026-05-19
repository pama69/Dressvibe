import React, { useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform, Linking } from "react-native";
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
  onShare?: () => void;
  onPublishTelegram?: () => void;
  publishingTelegram?: boolean;
  onOpenStudio?: () => void;
  showActions?: boolean;
};

export default function VideoCard({ url, width, height, expired, onDelete, onShare, onPublishTelegram, publishingTelegram, onOpenStudio, showActions = true }: Props) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = true;
    // autoplay disabled — let the user tap play to avoid bandwidth surprises
  });

  useEffect(() => {
    return () => {
      try { player.pause(); } catch {}
    };
  }, [player]);

  const handleCopyLink = async () => {
    await Clipboard.setStringAsync(url);
    if (Platform.OS === "web") window.alert("Link copiato!"); else Alert.alert("Link copiato!", "Incolla dove vuoi.");
  };

  const handleOpen = async () => {
    if (Platform.OS === "web") {
      window.open(url, "_blank");
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
              Il link xAI è scaduto. I nuovi video vengono archiviati automaticamente; questo è stato generato prima della fix.
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
        <View style={s.actions}>
          {onOpenStudio ? (
            <TouchableOpacity
              onPress={onOpenStudio}
              style={[s.actionBtn, s.studioBtn]}
              testID="video-open-studio"
            >
              <Ionicons name="brush-outline" size={14} color={theme.colors.text} />
              <Text style={s.actionText}>Apri Studio</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={handleOpen} style={s.actionBtn} testID="video-open">
            <Ionicons name="open-outline" size={14} color={theme.colors.text} />
            <Text style={s.actionText}>Apri</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleCopyLink} style={s.actionBtn} testID="video-copy">
            <Ionicons name="link-outline" size={14} color={theme.colors.text} />
            <Text style={s.actionText}>Copia link</Text>
          </TouchableOpacity>
          {onPublishTelegram ? (
            <TouchableOpacity
              onPress={onPublishTelegram}
              disabled={publishingTelegram}
              style={[s.actionBtn, s.tgBtn, publishingTelegram && { opacity: 0.5 }]}
              testID="video-publish-tg"
            >
              <Ionicons name="paper-plane" size={14} color={theme.colors.text} />
              <Text style={s.actionText}>{publishingTelegram ? "Invio…" : "🚀 Pubblica TG"}</Text>
            </TouchableOpacity>
          ) : null}
          {onShare ? (
            <TouchableOpacity onPress={onShare} style={[s.actionBtn, s.igBtn]} testID="video-share">
              <Ionicons name="logo-instagram" size={14} color={theme.colors.text} />
              <Text style={s.actionText}>Instagram</Text>
            </TouchableOpacity>
          ) : null}
          {onDelete ? (
            <TouchableOpacity onPress={onDelete} style={[s.actionBtn, s.danger]} testID="video-delete">
              <Ionicons name="trash-outline" size={14} color={theme.colors.error} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  player: {
    backgroundColor: "#000",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actions: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 8, paddingHorizontal: 10,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  actionText: { color: theme.colors.text, fontSize: 11 },
  tgBtn: {
    borderColor: "#2AABEE",
    backgroundColor: "rgba(42,171,238,0.15)",
  },
  igBtn: {
    borderColor: "#dd2a7b",
    backgroundColor: "rgba(221,42,123,0.12)",
  },
  studioBtn: {
    borderColor: theme.colors.magic2,
    backgroundColor: "rgba(225,29,72,0.12)",
  },
  expired: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 8,
    paddingHorizontal: 18,
  },
  expiredTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  expiredSub: { color: theme.colors.textMuted, fontSize: 11, textAlign: "center", lineHeight: 16 },
  danger: { borderColor: theme.colors.error },
});
