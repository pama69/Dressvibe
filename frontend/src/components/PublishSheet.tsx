import React, { useEffect, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/src/theme";
import { storage } from "@/src/utils/storage";

// Comma-joined channel keys. A value written by the old single-channel sheet
// (just "telegram") parses as a one-element list, so nothing to migrate.
const LAST_USED_KEY = "dv_last_publish_channel";

export type PublishChannel = {
  /** Stable id used to remember the last used channels. */
  key: string;
  label: string;
  hint?: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  /** Opens a modal / system share sheet instead of publishing on its own.
   *  These run last so an automatic publish can't fire under their UI. */
  interactive?: boolean;
  onPress: () => void | Promise<void>;
};

/**
 * Unified publish sheet: one "Pubblica" entry point that lists only the
 * channels the shop owner can actually use. Each channel has a checkbox, so
 * several can be posted with a single tap on the confirm button; the channels
 * used last time come back pre-ticked, so the common case stays one tap.
 */
export default function PublishSheet({
  visible,
  onClose,
  channels,
  subtitle = "Scegli dove postare questo scatto.",
}: {
  visible: boolean;
  onClose: () => void;
  channels: PublishChannel[];
  subtitle?: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      const v = await storage.getItem<string>(LAST_USED_KEY, "");
      const keys = (v || "").split(",").filter(Boolean);
      setSelected(keys.filter((k) => channels.some((c) => c.key === k)));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (key: string) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const publish = async () => {
    const picked = channels.filter((c) => selected.includes(c.key));
    if (!picked.length) return;
    try { await storage.setItem(LAST_USED_KEY, picked.map((c) => c.key).join(",")); } catch {}
    onClose();
    // Defer so the sheet is dismissed before any follow-up modal/alert opens.
    setTimeout(async () => {
      // Automatic channels first, interactive ones (share sheets) last.
      const ordered = [...picked].sort((a, b) => Number(!!a.interactive) - Number(!!b.interactive));
      for (const c of ordered) {
        try { await c.onPress(); } catch {}
        // ponytail: fixed gap between actions; if two interactive channels
        // ever need to hand off cleanly, chain them on their sheet's onClose.
        await new Promise((r) => setTimeout(r, 400));
      }
    }, 60);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.handle} />
          <Text style={s.title}>📢 Pubblica</Text>
          <Text style={s.subtitle}>{subtitle}</Text>

          <View style={{ gap: 10, marginTop: 8 }}>
            {channels.map((c) => {
              const on = selected.includes(c.key);
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[s.row, { borderColor: on ? c.color : theme.colors.border }]}
                  onPress={() => toggle(c.key)}
                  activeOpacity={0.85}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  testID={`publish-${c.key}`}
                >
                  <Ionicons
                    name={on ? "checkbox" : "square-outline"}
                    size={22}
                    color={on ? c.color : theme.colors.textMuted}
                  />
                  <Ionicons name={c.icon} size={22} color={c.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowLabel}>{c.label}</Text>
                    {c.hint ? <Text style={s.rowHint}>{c.hint}</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[s.cta, !selected.length && s.ctaOff]}
            onPress={publish}
            disabled={!selected.length}
            activeOpacity={0.85}
            testID="publish-confirm"
          >
            <Text style={s.ctaText}>
              {selected.length > 1 ? `Pubblica su ${selected.length} canali` : "Pubblica"}
            </Text>
          </TouchableOpacity>

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
  cta: {
    marginTop: 16, paddingVertical: 15, borderRadius: 14, alignItems: "center",
    backgroundColor: theme.colors.primary,
  },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: theme.colors.primaryFg, fontSize: 15, fontWeight: "700" },
  cancel: { marginTop: 8, paddingVertical: 12, alignItems: "center" },
  cancelText: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: "600" },
});
