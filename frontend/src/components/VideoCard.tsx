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
  onDelete?: () => void;
  onShare?: () => void;
  showActions?: boolean;
};

export default function VideoCard({ url, width, height, onDelete, onShare, showActions = true }: Props) {
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
        <VideoView
          player={player}
          style={{ width, height }}
          contentFit="cover"
          nativeControls
          allowsFullscreen
          allowsPictureInPicture
        />
      </View>
      {showActions ? (
        <View style={s.actions}>
          <TouchableOpacity onPress={handleOpen} style={s.actionBtn} testID="video-open">
            <Ionicons name="open-outline" size={14} color={theme.colors.text} />
            <Text style={s.actionText}>Apri</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleCopyLink} style={s.actionBtn} testID="video-copy">
            <Ionicons name="link-outline" size={14} color={theme.colors.text} />
            <Text style={s.actionText}>Copia link</Text>
          </TouchableOpacity>
          {onShare ? (
            <TouchableOpacity onPress={onShare} style={s.actionBtn} testID="video-share">
              <Ionicons name="share-social-outline" size={14} color={theme.colors.text} />
              <Text style={s.actionText}>Condividi</Text>
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
  danger: { borderColor: theme.colors.error },
});
