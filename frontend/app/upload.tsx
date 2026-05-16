import React, { useState } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { CATEGORIES, SEASONS, GENDERS } from "@/src/constants/options";

// Robust base64 extractor — handles native (asset.base64) and web (blob/data URI).
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

export default function Upload() {
  const router = useRouter();
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("t-shirt");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [season, setSeason] = useState("");
  const [gender, setGender] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickImage = async () => {
    try {
      if (Platform.OS !== "web") {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          notify("Permesso negato", "Concedi l'accesso alla galleria per caricare un capo.");
          return;
        }
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        base64: true,
        quality: 0.55,
        allowsEditing: Platform.OS !== "web",
        aspect: Platform.OS !== "web" ? [4, 5] : undefined,
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;
      const b64 = await assetToBase64(res.assets[0]);
      if (!b64) {
        notify("Errore", "Impossibile leggere la foto. Prova un'altra immagine.");
        return;
      }
      setImageBase64(b64);
      setError(null);
    } catch (e: any) {
      console.warn("pickImage", e);
      notify("Errore", e?.message || "Impossibile aprire la galleria");
    }
  };

  const takePhoto = async () => {
    try {
      if (Platform.OS === "web") {
        // Same input on web — opens file picker.
        await pickImage();
        return;
      }
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        notify("Permesso negato", "Concedi l'accesso alla fotocamera per scattare una foto.");
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        base64: true,
        quality: 0.55,
        allowsEditing: true,
        aspect: [4, 5],
      });
      if (res.canceled || !res.assets?.[0]) return;
      const b64 = await assetToBase64(res.assets[0]);
      if (b64) {
        setImageBase64(b64);
        setError(null);
      }
    } catch (e: any) {
      console.warn("takePhoto", e);
      notify("Errore", e?.message || "Impossibile aprire la fotocamera");
    }
  };

  const save = async () => {
    setError(null);
    if (!imageBase64) {
      setError("Scegli o scatta una foto del capo prima di salvare.");
      notify("Foto richiesta", "Scegli o scatta una foto del capo.");
      return;
    }
    if (!name.trim()) {
      setError("Inserisci il nome del capo.");
      notify("Nome richiesto", "Inserisci il nome del capo.");
      return;
    }
    setSaving(true);
    try {
      await api.createGarment({
        name: name.trim(),
        image_base64: imageBase64,
        category,
        color: color.trim() || null,
        size: size.trim() || null,
        price: price ? parseFloat(price) : null,
        season: season || null,
        gender: gender || null,
      });
      router.back();
    } catch (e: any) {
      const msg = e?.message || "Impossibile salvare";
      console.warn("save error", e);
      setError(msg);
      notify("Errore", msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} testID="upload-close">
            <Ionicons name="close" size={24} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Nuovo capo</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {imageBase64 ? (
            <View style={s.preview}>
              <Image source={{ uri: `data:image/png;base64,${imageBase64}` }} style={s.previewImg} />
              <TouchableOpacity style={s.previewChange} onPress={pickImage} testID="upload-change">
                <Text style={s.previewChangeText}>Cambia</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.pickRow}>
              <TouchableOpacity style={s.pickBox} onPress={pickImage} testID="upload-from-library">
                <Ionicons name="images-outline" size={26} color={theme.colors.text} />
                <Text style={s.pickText}>{Platform.OS === "web" ? "Scegli foto" : "Galleria"}</Text>
              </TouchableOpacity>
              {Platform.OS !== "web" && (
                <TouchableOpacity style={s.pickBox} onPress={takePhoto} testID="upload-from-camera">
                  <Ionicons name="camera-outline" size={26} color={theme.colors.text} />
                  <Text style={s.pickText}>Scatta foto</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <Text style={s.fieldLabel}>Nome capo</Text>
          <TextInput
            value={name} onChangeText={setName}
            placeholder="es. Maglione cashmere rosa"
            placeholderTextColor={theme.colors.textMuted}
            style={s.input}
            testID="upload-name"
          />

          <Text style={s.fieldLabel}>Categoria</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c.value} onPress={() => setCategory(c.value)}
                style={[s.chip, category === c.value && s.chipA]}
                testID={`upload-cat-${c.value}`}
              >
                <Text style={[s.chipT, category === c.value && s.chipTA]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={s.row2}>
            <View style={{ flex: 1 }}>
              <Text style={s.fieldLabel}>Colore</Text>
              <TextInput value={color} onChangeText={setColor} placeholder="es. Beige"
                placeholderTextColor={theme.colors.textMuted} style={s.input} testID="upload-color" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.fieldLabel}>Taglia</Text>
              <TextInput value={size} onChangeText={setSize} placeholder="S, M, L, 42…"
                placeholderTextColor={theme.colors.textMuted} style={s.input} testID="upload-size" />
            </View>
          </View>

          <Text style={s.fieldLabel}>Prezzo (€)</Text>
          <TextInput
            value={price} onChangeText={setPrice} keyboardType="decimal-pad"
            placeholder="49.90"
            placeholderTextColor={theme.colors.textMuted} style={s.input}
            testID="upload-price"
          />

          <Text style={s.fieldLabel}>Stagione</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            {SEASONS.map((c) => (
              <TouchableOpacity key={c.value} onPress={() => setSeason(c.value)}
                style={[s.chip, season === c.value && s.chipA]} testID={`upload-season-${c.value}`}>
                <Text style={[s.chipT, season === c.value && s.chipTA]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={s.fieldLabel}>Per</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            {GENDERS.map((c) => (
              <TouchableOpacity key={c.value} onPress={() => setGender(c.value)}
                style={[s.chip, gender === c.value && s.chipA]} testID={`upload-gender-${c.value}`}>
                <Text style={[s.chipT, gender === c.value && s.chipTA]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {error ? (
            <View style={s.errorBox} testID="upload-error">
              <Ionicons name="alert-circle-outline" size={16} color={theme.colors.error} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={{ height: 30 }} />
        </ScrollView>

        <View style={s.footer}>
          <TouchableOpacity
            onPress={save}
            style={[s.saveBtn, saving && { opacity: 0.6 }]}
            disabled={saving}
            testID="upload-save"
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color={theme.colors.primaryFg} />
              : <Text style={s.saveBtnText}>Salva nel guardaroba</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    paddingHorizontal: 20, paddingVertical: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  headerTitle: { color: theme.colors.text, fontSize: 14, letterSpacing: 2, textTransform: "uppercase" },
  scroll: { padding: 24, gap: 6 },
  pickRow: { flexDirection: "row", gap: 12, marginBottom: 6 },
  pickBox: {
    flex: 1, height: 180, alignItems: "center", justifyContent: "center", gap: 10,
    borderWidth: 1, borderColor: theme.colors.border, borderStyle: "dashed",
    backgroundColor: theme.colors.surface,
  },
  pickText: { color: theme.colors.text, fontSize: 12, letterSpacing: 1 },
  preview: { height: 280, position: "relative", marginBottom: 6 },
  previewImg: { width: "100%", height: "100%" },
  previewChange: {
    position: "absolute", bottom: 10, right: 10,
    backgroundColor: "rgba(0,0,0,0.6)", paddingVertical: 8, paddingHorizontal: 14,
  },
  previewChangeText: { color: theme.colors.text, fontSize: 12, letterSpacing: 0.4 },
  fieldLabel: {
    color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 2,
    textTransform: "uppercase", marginTop: 14, marginBottom: 6,
  },
  input: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    color: theme.colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14,
  },
  row2: { flexDirection: "row", gap: 12 },
  chipRow: { gap: 8, paddingRight: 16 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  chipA: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  chipT: { color: theme.colors.text, fontSize: 12 },
  chipTA: { color: theme.colors.primaryFg, fontWeight: "600" },
  errorBox: {
    marginTop: 14, padding: 12, borderWidth: 1, borderColor: theme.colors.error,
    backgroundColor: "rgba(239,68,68,0.08)",
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  errorText: { color: theme.colors.error, fontSize: 12, flex: 1 },
  footer: {
    padding: 20, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.bg,
  },
  saveBtn: { backgroundColor: theme.colors.primary, paddingVertical: 18, alignItems: "center" },
  saveBtnText: { color: theme.colors.primaryFg, fontWeight: "700", letterSpacing: 0.4, fontSize: 15 },
});
