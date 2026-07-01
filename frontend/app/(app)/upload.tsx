import React, { useCallback, useRef, useState } from "react";
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
import { useRouter, useFocusEffect } from "expo-router";
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
  const [category, setCategory] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [season, setSeason] = useState("");
  const [gender, setGender] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After a successful save we navigate back via router.back(). Expo Router may
  // keep this screen mounted, so the next time the user opens "Aggiungi capo"
  // they would see the previous photo still there with only a "Cambia" button
  // visible (no Galleria / Scatta foto). This flag resets the form the next
  // time the screen becomes focused after a save.
  const didSaveRef = useRef(false);

  const resetForm = useCallback(() => {
    setImageBase64(null);
    setName("");
    setCategory("");
    setColor("");
    setSize("");
    setPrice("");
    setSeason("");
    setGender("");
    setError(null);
    setSaving(false);
  }, []);

  // When the screen comes (back) into focus, if the previous visit ended with
  // a successful save, wipe the form so the user lands on the initial
  // "Galleria / Scatta foto" picker. We don't reset on every focus to preserve
  // form state if the user only dipped into /backgrounds and came back.
  useFocusEffect(
    useCallback(() => {
      if (didSaveRef.current) {
        didSaveRef.current = false;
        resetForm();
      }
    }, [resetForm])
  );

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
        // Skip the forced crop step — user wanted the picker to return the
        // photo as-is. They can re-pick if they want a different framing.
        allowsEditing: false,
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
      if (Platform.OS !== "web") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          notify("Permesso negato", "Concedi l'accesso alla fotocamera per scattare una foto.");
          return;
        }
      }
      const res = await ImagePicker.launchCameraAsync({
        base64: true,
        quality: 0.55,
        // No forced crop after the shot — user wanted the photo saved as-is.
        allowsEditing: false,
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
    // La categoria guida la generazione (ruolo del capo nell'outfit), quindi
    // ora è obbligatoria: un solo tap, ma va scelta.
    if (!category) {
      setError("Scegli la categoria del capo (Giacca, Camicia, Maglia…).");
      notify("Categoria richiesta", "Tocca la categoria del capo prima di salvare.");
      return;
    }
    // "Descrizione e prezzi" is OPTIONAL. If the user didn't type anything we
    // auto-generate a unique placeholder code "Cap NNNN" so the garment still
    // has a stable identifier in the gallery — and the backend knows there
    // is no real description / price list to bake into the prompt.
    const trimmed = name.trim();
    const finalName = trimmed || `Cap ${String(Math.floor(1000 + Math.random() * 9000))}`;
    setSaving(true);
    try {
      await api.createGarment({
        name: finalName,
        image_base64: imageBase64,
        category,
        color: color.trim() || null,
        size: size.trim() || null,
        price: price ? parseFloat(price) : null,
        season: season || null,
        gender: gender || null,
      });
      // Mark the save so the next focus on this screen resets the form
      // (in case Expo Router keeps the component mounted).
      didSaveRef.current = true;
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
          <TouchableOpacity
            onPress={() => router.push("/backgrounds")}
            style={s.bgLink}
            testID="upload-open-backgrounds"
          >
            <Ionicons name="image-outline" size={14} color={theme.colors.text} />
            <Text style={s.bgLinkText}>SFONDI</Text>
          </TouchableOpacity>
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
              <TouchableOpacity style={s.pickBox} onPress={takePhoto} testID="upload-from-camera">
                <Ionicons name="camera-outline" size={26} color={theme.colors.text} />
                <Text style={s.pickText}>Scatta foto</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={s.fieldLabel}>Descrizione e prezzi</Text>
          <Text style={s.fieldHint}>
            Facoltativo — es. "Vestito €59, pantalone €67". Se compilato, i prezzi appariranno come piccole etichette nella foto generata.
          </Text>
          <TextInput
            value={name} onChangeText={setName}
            placeholder='es. Vestito €59, pantalone €67'
            placeholderTextColor={theme.colors.textMuted}
            style={s.input}
            testID="upload-name"
          />

          <Text style={s.fieldLabel}>Categoria *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c.value} onPress={() => setCategory(c.value)}
                style={[s.chip, category === c.value && s.chipA]}
                testID={`upload-cat-${c.value}`}
              >
                <Text style={[s.chipT, category === c.value && s.chipTA]}>
                  {c.emoji ? `${c.emoji}  ` : ""}{c.label}
                </Text>
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
  bgLink: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 6, paddingHorizontal: 10,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8,
  },
  bgLinkText: { color: theme.colors.text, fontSize: 10, letterSpacing: 1.4, fontWeight: "600" },
  scroll: { padding: 24, gap: 6 },
  pickRow: { flexDirection: "row", gap: 12, marginBottom: 6 },
  pickBox: {
    flex: 1, height: 180, alignItems: "center", justifyContent: "center", gap: 10,
    borderWidth: 1, borderColor: theme.colors.border, borderStyle: "dashed",
    backgroundColor: theme.colors.surface, borderRadius: 14,
    shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  pickText: { color: theme.colors.text, fontSize: 12, letterSpacing: 1 },
  preview: {
    height: 280, position: "relative", marginBottom: 6,
    backgroundColor: "#fff", borderRadius: 16, padding: 5,
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 6,
  },
  previewImg: { width: "100%", height: "100%", borderRadius: 12 },
  previewChange: {
    position: "absolute", bottom: 14, right: 14,
    backgroundColor: "rgba(0,0,0,0.6)", paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10,
  },
  previewChangeText: { color: theme.colors.text, fontSize: 12, letterSpacing: 0.4 },
  fieldLabel: {
    color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 2,
    textTransform: "uppercase", marginTop: 14, marginBottom: 6,
  },
  fieldHint: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 15, marginBottom: 8, marginTop: -2 },
  input: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    color: theme.colors.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, borderRadius: 10,
  },
  row2: { flexDirection: "row", gap: 12 },
  chipRow: { gap: 8, paddingRight: 16 },
  chip: {
    paddingVertical: 8, paddingHorizontal: 14,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, borderRadius: 20,
  },
  chipA: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  chipT: { color: theme.colors.text, fontSize: 12 },
  chipTA: { color: theme.colors.primaryFg, fontWeight: "600" },
  errorBox: {
    marginTop: 14, padding: 12, borderWidth: 1, borderColor: theme.colors.error,
    backgroundColor: "rgba(239,68,68,0.08)",
    flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10,
  },
  errorText: { color: theme.colors.error, fontSize: 12, flex: 1 },
  // paddingBottom extra: la barra dei tab fluttuante (assoluta, ~80px) copre
  // il bordo inferiore dello schermo, quindi alziamo il pulsante "Salva".
  footer: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 96, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.bg },
  saveBtn: { backgroundColor: theme.colors.primary, paddingVertical: 18, alignItems: "center", borderRadius: 14 },
  saveBtnText: { color: theme.colors.primaryFg, fontWeight: "700", letterSpacing: 0.4, fontSize: 15 },
});
