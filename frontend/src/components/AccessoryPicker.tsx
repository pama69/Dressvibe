// Shared "Aggiungi accessori" UI block used by both the Generation
// screen (when creating a fresh look from a garment) AND the Studio
// screen (when editing an already-generated photo). Keeping the picker
// in a single component guarantees the two flows behave identically
// — same category list, same upload limits, same labels — and avoids
// drift if we later add new categories or extra constraints.
//
// The parent owns the list state and just tells us:
//   - `enabled`   : whether the parent's checkbox is ON (we render
//                   nothing when OFF so the parent controls toggle UX)
//   - `items`     : current accessories
//   - `setItems`  : setter (we call it on add/remove)
//   - `max`       : hard upload cap (defaults to 5)
//
// We deliberately request `quality: 0.55` and accept `images` only so
// the base64 payload stays small enough to be sent to Gemini alongside
// the source image without blowing through the per-request budget.

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { theme } from "@/src/theme";
import type { AccessoryItem } from "@/src/state/genStore";

export const ACCESSORY_CATEGORIES: { id: string; label: string; emoji: string }[] = [
  { id: "scarpe",   label: "Scarpe",   emoji: "👟" },
  { id: "borse",    label: "Borse",    emoji: "👜" },
  { id: "gioielli", label: "Gioielli", emoji: "💎" },
  { id: "cappelli", label: "Cappelli", emoji: "🎩" },
  { id: "occhiali", label: "Occhiali", emoji: "🕶️" },
  { id: "cinture",  label: "Cinture",  emoji: "🪢" },
  { id: "sciarpe",  label: "Sciarpe",  emoji: "🧣" },
  { id: "altro",    label: "Altro",    emoji: "✨" },
];

const DEFAULT_MAX = 5;

// Robust base64 extractor — handles native (asset.base64) and web
// (blob/data URI). Mirrors the helper used on the Upload screen.
async function assetToB64(asset: ImagePicker.ImagePickerAsset): Promise<string | null> {
  if (asset.base64 && asset.base64.length > 0) return asset.base64;
  if (!asset.uri) return null;
  try {
    const res = await fetch(asset.uri);
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        const comma = dataUrl.indexOf(",");
        resolve(comma >= 0 ? dataUrl.slice(comma + 1) : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

type Props = {
  enabled: boolean;
  items: AccessoryItem[];
  setItems: (next: AccessoryItem[] | ((prev: AccessoryItem[]) => AccessoryItem[])) => void;
  max?: number;
  /** Test-id suffix so two pickers on the same screen don't clash. */
  testIdScope?: string;
};

export default function AccessoryPicker({
  enabled,
  items,
  setItems,
  max = DEFAULT_MAX,
  testIdScope = "acc",
}: Props) {
  const [category, setCategory] = useState<string>("scarpe");
  const [busy, setBusy] = useState(false);

  if (!enabled) return null;

  // Cast-helper so React state updates can accept either a value or a
  // functional updater regardless of which signature the parent picked.
  const update = (next: AccessoryItem[] | ((prev: AccessoryItem[]) => AccessoryItem[])) => {
    if (typeof next === "function") {
      setItems(next as any);
    } else {
      setItems(() => next);
    }
  };

  const append = (b64: string) => {
    if (!b64) return;
    update((curr) => (curr.length >= max ? curr : [...curr, { category, image_base64: b64 }]));
  };

  const remove = (idx: number) => update((curr) => curr.filter((_, i) => i !== idx));

  const pickFromGallery = async () => {
    if (busy) return;
    if (items.length >= max) {
      Alert.alert("Limite raggiunto", `Puoi aggiungere al massimo ${max} accessori.`);
      return;
    }
    setBusy(true);
    try {
      if (Platform.OS !== "web") {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Permesso negato",
            "Concedi l'accesso alla galleria per aggiungere un accessorio."
          );
          return;
        }
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        base64: true,
        quality: 0.55,
        allowsEditing: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const b64 = await assetToB64(res.assets[0]);
      if (!b64) {
        Alert.alert("Errore", "Impossibile leggere la foto. Prova un'altra immagine.");
        return;
      }
      append(b64);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile aprire la galleria");
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    if (busy) return;
    if (items.length >= max) {
      Alert.alert("Limite raggiunto", `Puoi aggiungere al massimo ${max} accessori.`);
      return;
    }
    setBusy(true);
    try {
      if (Platform.OS !== "web") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Permesso negato",
            "Concedi l'accesso alla fotocamera per scattare la foto."
          );
          return;
        }
      }
      const res = await ImagePicker.launchCameraAsync({
        base64: true,
        quality: 0.55,
        allowsEditing: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const b64 = await assetToB64(res.assets[0]);
      if (b64) append(b64);
    } catch (e: any) {
      Alert.alert("Errore", e?.message || "Impossibile aprire la fotocamera");
    } finally {
      setBusy(false);
    }
  };

  const atMax = items.length >= max;

  return (
    <View style={s.box}>
      {/* Category picker */}
      <Text style={s.subLabel}>Categoria accessorio</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingRight: 12 }}
      >
        {ACCESSORY_CATEGORIES.map((c) => {
          const active = category === c.id;
          return (
            <TouchableOpacity
              key={c.id}
              onPress={() => setCategory(c.id)}
              style={[s.chip, active && s.chipActive]}
              activeOpacity={0.85}
              testID={`${testIdScope}-cat-${c.id}`}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>
                {c.emoji}  {c.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Pickers */}
      <View style={s.btnRow}>
        <TouchableOpacity
          onPress={pickFromGallery}
          disabled={busy || atMax}
          style={[s.btn, (busy || atMax) && { opacity: 0.45 }]}
          activeOpacity={0.85}
          testID={`${testIdScope}-pick-gallery`}
        >
          <Ionicons name="images-outline" size={16} color={theme.colors.text} />
          <Text style={s.btnText}>Galleria</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={takePhoto}
          disabled={busy || atMax}
          style={[s.btn, (busy || atMax) && { opacity: 0.45 }]}
          activeOpacity={0.85}
          testID={`${testIdScope}-take-photo`}
        >
          <Ionicons name="camera-outline" size={16} color={theme.colors.text} />
          <Text style={s.btnText}>Scatta foto</Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {items.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={s.subLabel}>
            Accessori aggiunti ({items.length}/{max})
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 10, paddingRight: 12 }}
          >
            {items.map((acc, idx) => {
              const meta = ACCESSORY_CATEGORIES.find((c) => c.id === acc.category);
              return (
                <View key={idx} style={s.thumbWrap}>
                  <Image
                    source={{ uri: `data:image/jpeg;base64,${acc.image_base64}` }}
                    style={s.thumb}
                  />
                  <View style={s.thumbLabelWrap}>
                    <Text style={s.thumbLabel} numberOfLines={1}>
                      {meta ? `${meta.emoji} ${meta.label}` : acc.category}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => remove(idx)}
                    style={s.removeBtn}
                    hitSlop={8}
                    testID={`${testIdScope}-remove-${idx}`}
                  >
                    <Ionicons name="close" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : (
        <Text style={s.empty}>
          Nessun accessorio aggiunto. Seleziona una categoria e tocca Galleria o Scatta foto.
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    marginTop: 8,
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  subLabel: {
    color: theme.colors.textSecondary,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
  },
  chipActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary,
  },
  chipText: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: theme.colors.primaryFg },
  btnRow: { flexDirection: "row", gap: 10 },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
  },
  btnText: { color: theme.colors.text, fontSize: 13, fontWeight: "600", letterSpacing: 0.3 },
  empty: {
    color: theme.colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    fontStyle: "italic",
  },
  thumbWrap: {
    width: 90,
    height: 110,
    backgroundColor: theme.colors.bg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
    position: "relative",
  },
  thumb: { width: "100%", height: 80 },
  thumbLabelWrap: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  thumbLabel: { color: theme.colors.text, fontSize: 10, letterSpacing: 0.2 },
  removeBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
});
