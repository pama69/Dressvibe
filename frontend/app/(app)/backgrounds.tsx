import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { useConfirm } from "@/src/contexts/ConfirmContext";

async function assetToBase64(asset: ImagePicker.ImagePickerAsset): Promise<string | null> {
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
  } catch (e) {
    console.warn("assetToBase64 failed", e);
    return null;
  }
}

function notify(title: string, msg?: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.alert(msg ? `${title}\n\n${msg}` : title);
  } else {
    Alert.alert(title, msg);
  }
}

type BG = { id: string; name: string; description?: string | null; image_base64: string; created_at: string };

export default function BackgroundsScreen() {
  const router = useRouter();
  const confirm = useConfirm();
  const { width: winW } = useWindowDimensions();
  const numCols = winW > 700 ? 3 : 2;
  const gap = 12;
  const padding = 20;
  const tileW = Math.floor((winW - padding * 2 - gap * (numCols - 1)) / numCols);

  const [items, setItems] = useState<BG[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.listBackgrounds();
      setItems(res as BG[]);
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile caricare gli sfondi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pickImage = async (fromCamera = false) => {
    try {
      const permission = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (Platform.OS !== "web" && permission.status !== "granted") {
        notify("Permesso negato");
        return;
      }
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.55 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            base64: true,
            quality: 0.55,
            allowsEditing: Platform.OS !== "web",
          });
      if (res.canceled || !res.assets || res.assets.length === 0) return;
      const b64 = await assetToBase64(res.assets[0]);
      if (!b64) { notify("Errore", "Impossibile leggere l'immagine"); return; }
      setImageBase64(b64);
    } catch (e: any) {
      notify("Errore", e?.message || "Selezione immagine fallita");
    }
  };

  const save = async () => {
    if (!imageBase64) { notify("Aggiungi una foto"); return; }
    if (!name.trim()) { notify("Aggiungi un nome per lo sfondo"); return; }
    setSaving(true);
    try {
      await api.createBackground({
        name: name.trim(),
        image_base64: imageBase64,
        description: description.trim() || undefined,
      });
      setImageBase64(null); setName(""); setDescription("");
      setAdding(false);
      await load();
      notify("Sfondo salvato ✨");
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile salvare lo sfondo");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (bg: BG) => {
    const ok = await confirm({
      title: "Eliminare sfondo?",
      message: `“${bg.name}” verrà rimosso definitivamente.`,
    });
    if (!ok) return;
    try {
      await api.deleteBackground(bg.id);
      setItems((p) => p.filter((x) => x.id !== bg.id));
    } catch (e: any) {
      notify("Errore", e?.message || "Impossibile eliminare");
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} testID="bg-close">
            <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Galleria sfondi</Text>
          <View style={{ width: 24 }} />
        </View>

        {adding ? (
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
            {imageBase64 ? (
              <View style={s.preview}>
                <Image source={{ uri: `data:image/png;base64,${imageBase64}` }} style={s.previewImg} />
                <TouchableOpacity style={s.previewChange} onPress={() => pickImage(false)} testID="bg-change">
                  <Text style={s.previewChangeText}>Cambia</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.pickRow}>
                <TouchableOpacity style={s.pickBox} onPress={() => pickImage(false)} testID="bg-pick-library">
                  <Ionicons name="images-outline" size={26} color={theme.colors.text} />
                  <Text style={s.pickText}>{Platform.OS === "web" ? "Scegli foto" : "Galleria"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.pickBox} onPress={() => pickImage(true)} testID="bg-pick-camera">
                  <Ionicons name="camera-outline" size={26} color={theme.colors.text} />
                  <Text style={s.pickText}>Scatta foto</Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={s.fieldLabel}>Nome sfondo</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="es. Vetrina del negozio · Borgo medievale · Spiaggia di Levante"
              placeholderTextColor={theme.colors.textMuted}
              style={s.input}
              testID="bg-name"
              maxLength={80}
            />

            <Text style={s.fieldLabel}>Descrizione (opzionale)</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="es. luci serali calde, tessuti caldi, atmosfera natalizia"
              placeholderTextColor={theme.colors.textMuted}
              style={[s.input, { minHeight: 80, textAlignVertical: "top" }]}
              multiline
              testID="bg-desc"
              maxLength={160}
            />

            <Text style={s.hint}>
              Suggerimento: usa una foto pulita dello scenario reale (negozio, location, paesaggio). L'AI ricreerà l'atmosfera della foto come sfondo della modella.
            </Text>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <TouchableOpacity
                style={[s.cta, s.ctaSecondary, { flex: 1 }]}
                onPress={() => { setAdding(false); setImageBase64(null); setName(""); setDescription(""); }}
                disabled={saving}
                testID="bg-cancel"
              >
                <Text style={s.ctaSecondaryText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.cta, { flex: 1, opacity: saving ? 0.6 : 1 }]}
                onPress={save}
                disabled={saving}
                testID="bg-save"
              >
                {saving ? <ActivityIndicator color="#000" /> : <Text style={s.ctaText}>Salva sfondo</Text>}
              </TouchableOpacity>
            </View>
            <View style={{ height: 40 }} />
          </ScrollView>
        ) : loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={theme.colors.text} />
          </View>
        ) : items.length === 0 ? (
          <View style={s.empty} testID="bg-empty">
            <Ionicons name="image-outline" size={40} color={theme.colors.textMuted} />
            <Text style={s.emptyTitle}>Nessuno sfondo ancora</Text>
            <Text style={s.emptyDesc}>
              Carica le foto della tua vetrina, del tuo negozio o di location iconiche per il tuo brand.
              Potrai sceglierle come sfondo nelle prossime generazioni.
            </Text>
            <TouchableOpacity style={s.cta} onPress={() => setAdding(true)} testID="bg-add-first">
              <Ionicons name="add" size={18} color="#000" />
              <Text style={s.ctaText}>Aggiungi sfondo</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            key={`cols-${numCols}`}
            numColumns={numCols}
            data={items}
            keyExtractor={(it) => it.id}
            contentContainerStyle={{ padding, gap }}
            columnWrapperStyle={numCols > 1 ? { gap } : undefined}
            ItemSeparatorComponent={() => <View style={{ height: gap }} />}
            renderItem={({ item }) => (
              <View style={[s.card, { width: tileW }]}>
                <Image
                  source={{ uri: `data:image/png;base64,${item.image_base64}` }}
                  style={{ width: tileW, height: Math.round(tileW * (16 / 9)) }}
                />
                <View style={s.cardBody}>
                  <Text style={s.cardName} numberOfLines={1}>{item.name}</Text>
                  {item.description ? (
                    <Text style={s.cardDesc} numberOfLines={2}>{item.description}</Text>
                  ) : null}
                  <TouchableOpacity onPress={() => remove(item)} style={s.cardDelete} testID={`bg-del-${item.id}`}>
                    <Ionicons name="trash-outline" size={14} color={theme.colors.error} />
                    <Text style={s.cardDeleteText}>Elimina</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            ListFooterComponent={<View style={{ height: 100 }} />}
          />
        )}

        {!adding && !loading && items.length > 0 ? (
          <TouchableOpacity style={s.fab} onPress={() => setAdding(true)} testID="bg-fab-add">
            <Ionicons name="add" size={24} color="#000" />
            <Text style={s.ctaText}>Nuovo sfondo</Text>
          </TouchableOpacity>
        ) : null}
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
  headerTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "600" },
  scroll: { padding: 20, gap: 8 },
  preview: { backgroundColor: theme.colors.surface, padding: 8, alignItems: "center" },
  previewImg: { width: "100%", aspectRatio: 9 / 16, maxHeight: 360, resizeMode: "cover" },
  previewChange: {
    position: "absolute", right: 16, top: 16,
    paddingVertical: 6, paddingHorizontal: 12,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  previewChangeText: { color: "#fff", fontSize: 11 },
  pickRow: { flexDirection: "row", gap: 12 },
  pickBox: {
    flex: 1, paddingVertical: 28, borderWidth: 1, borderColor: theme.colors.border,
    borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 8,
  },
  pickText: { color: theme.colors.text, fontSize: 13 },
  fieldLabel: { color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 2, marginTop: 16, textTransform: "uppercase" },
  input: {
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
    paddingHorizontal: 14, paddingVertical: 12, color: theme.colors.text, fontSize: 14,
  },
  hint: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 14 },
  cta: {
    backgroundColor: theme.colors.text, paddingVertical: 14, paddingHorizontal: 18,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  ctaText: { color: "#000", fontWeight: "700", letterSpacing: 0.4, fontSize: 14 },
  ctaSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.colors.border },
  ctaSecondaryText: { color: theme.colors.text, fontWeight: "600" },
  fab: {
    position: "absolute", right: 20, bottom: 24, flexDirection: "row",
    alignItems: "center", gap: 10, backgroundColor: theme.colors.text,
    paddingHorizontal: 18, paddingVertical: 14,
    shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 40 },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "600" },
  emptyDesc: { color: theme.colors.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 18 },
  card: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  cardBody: { padding: 10, gap: 4 },
  cardName: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  cardDesc: { color: theme.colors.textSecondary, fontSize: 11 },
  cardDelete: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6,
    paddingVertical: 6, paddingHorizontal: 8, alignSelf: "flex-start",
    borderWidth: 1, borderColor: theme.colors.error,
  },
  cardDeleteText: { color: theme.colors.error, fontSize: 11 },
});
