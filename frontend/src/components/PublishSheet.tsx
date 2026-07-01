import React, { useEffect, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { storage } from "@/src/utils/storage";

const LAST_USED_KEY = "dv_last_publish_channel";

export type PublishChannel = {
  /** Stable id used to remember the last used channel. */
  key: string;
  label: string;
  hint?: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
};

/**
 * Unified publish sheet: one "Pubblica" entry point that lists only the
 * channels the shop owner can actually use, remembers the last one used
 * (shown first with a badge) so the common case is a single tap.
 */
export default function PublishSheet({
  visible,
  onClose,
  channels,
}: {
  visible: boolean;
  onClose: () => void;
  channels: PublishChannel[];
}) {
  const [lastUsed, setLastUsed] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      const v = await storage.getItem<string>(LAST_USED_KEY, "");
      setLastUsed(v || null);
    })();
  }, [visible]);

  const pick = async (c: PublishChannel) => {
    try { await storage.setItem(LAST_USED_KEY, c.key); } catch {}
    onClose();
    // Defer so the modal is dismissed before any follow-up modal/alert opens.
    setTimeout(() => c.onPress(), 60);
  };

  // Last used first, rest keep their order.
  const ordered = [...channels].sort((a, b) => {
    if (a.key === lastUsed) return -1;
    if (b.key === lastUsed) return 1;
    return 0;
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.handle} />
          <Text style={s.title}>📢 Pubblica</Text>
          <Text style={s.subtitle}>Scegli dove postare questo scatto.</Text>

          <View style={{ gap: 10, marginTop: 8 }}>
            {ordered.map((c) => (
              <TouchableOpacity
                key={c.key}
                style={[s.row, { borderColor: c.color }]}
                onPress={() => pick(c)}
                activeOpacity={0.85}
                testID={`publish-${c.key}`}
              >
                <Ionicons name={c.icon} size={22} color={c.color} />
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>{c.label}</Text>
                  {c.hint ? <Text style={s.rowHint}>{c.hint}</Text> : null}
                </View>
                {c.key === lastUsed ? <Text style={s.badge}>Ultimo usato</Text> : null}
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={s.cancel} onPress={onClose} testID="publish-cancel">
            <Text style={s.cancelText}>Annulla</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 20, paddingBottom: 34,
    borderTopWidth: 1, borderColor: theme.colors.border,
  },
  handle: {
    alignSelf: "center", width: 40, height: 4, borderRadius: 2,
    backgroundColor: theme.colors.borderStrong, marginBottom: 14,
  },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: "700" },
  subtitle: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 14, paddingHorizontal: 16,
    borderWidth: 1, borderRadius: 14, backgroundColor: theme.colors.bg,
  },
  rowLabel: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  rowHint: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
  badge: {
    color: theme.colors.primaryFg, backgroundColor: theme.colors.primary,
    fontSize: 9, fontWeight: "700", letterSpacing: 0.5,
    paddingVertical: 3, paddingHorizontal: 7, borderRadius: 8, overflow: "hidden",
  },
  cancel: { marginTop: 16, paddingVertical: 14, alignItems: "center" },
  cancelText: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: "600" },
});
