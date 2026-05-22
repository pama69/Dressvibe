/**
 * Garment detail screen — opened by tapping a tile in the gallery.
 *
 * Shows the garment photo plus an "Aggiungi informazioni" field that maps
 * to the same `name` column already used by the upload flow ("Descrizione
 * e prezzi"). When the shop owner saves a real description here, every
 * future generation that uses this garment AND that has the
 * "Inserisci prezzi nell'immagine" toggle on will automatically get
 * price tags overlaid on the matching item.
 *
 * Auto-placeholder names produced by the upload flow ("Cap NNNN") are
 * hidden from the user: the field starts empty so the experience stays
 * clean. When the user clears the field on save we re-generate a fresh
 * "Cap NNNN" placeholder so backend price-tag filtering keeps working.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { theme, MAGIC_GRADIENT } from "@/src/theme";
import { useConfirm, useNotify } from "@/src/contexts/ConfirmContext";

// Same regex used on the backend (server.py / is_real_description) so the UI
// never shows the auto-generated "Cap NNNN" placeholders to the user.
const AUTO_NAME_RE = /^Cap\s+\d{3,5}$/i;

export default function GarmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const notify = useNotify();
  const confirm = useConfirm();
  const { width: winW } = useWindowDimensions();
  const imgSize = Math.min(winW - 32, 460);

  const [loading, setLoading] = useState(true);
  const [garment, setGarment] = useState<any>(null);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const g = await api.getGarment(id);
      setGarment(g);
      // Hide the auto "Cap NNNN" placeholder — show empty field instead.
      const realName = (g.name || "").trim();
      setDescription(AUTO_NAME_RE.test(realName) ? "" : realName);
    } catch (e: any) {
      notify({ title: "Errore", message: e?.message || "Capo non trovato" });
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, notify, router]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      // The backend treats `name=""` as "regenerate placeholder", so we
      // can simply forward the trimmed value as-is.
      const trimmed = description.trim();
      const res = await api.updateGarment(id, { name: trimmed });
      // Reflect server-side normalization (e.g. fresh Cap NNNN) in local state
      if (res && typeof res.name === "string") {
        const updatedName = res.name;
        setGarment((g: any) => (g ? { ...g, name: updatedName } : g));
      }
      notify({
        title: trimmed ? "Informazioni salvate ✓" : "Informazioni rimosse",
        message: trimmed
          ? "Saranno usate per i cartellini prezzo nelle prossime generazioni."
          : "Il capo ora userà un codice automatico.",
      });
    } catch (e: any) {
      notify({ title: "Errore salvataggio", message: e?.message || "Riprova" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    const ok = await confirm({
      title: "Eliminare questo capo?",
      message:
        "Lo eliminerai dalla galleria. Le generazioni esistenti che lo usano non verranno toccate, ma non potrai più riutilizzarlo per nuove generazioni.",
      destructiveText: "Elimina",
      cancelText: "Annulla",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.deleteGarment(id);
      router.back();
    } catch (e: any) {
      notify({ title: "Errore eliminazione", message: e?.message || "Riprova" });
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.center}>
          <ActivityIndicator color={theme.colors.text} />
        </View>
      </SafeAreaView>
    );
  }

  if (!garment) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.center}>
          <Text style={{ color: theme.colors.text }}>Capo non trovato</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {/* Header with back arrow */}
        <View style={s.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={s.backBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            testID="garment-back"
          >
            <Text style={s.backArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle} numberOfLines={1}>
            Dettaglio capo
          </Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Garment photo */}
          <View style={[s.imgWrap, { width: imgSize, height: imgSize }]}>
            <Image
              source={{ uri: `data:image/png;base64,${garment.image_base64}` }}
              style={s.img}
              resizeMode="cover"
            />
          </View>

          {/* Quick metadata badges */}
          <View style={s.metaRow}>
            {garment.category ? (
              <Text style={s.metaBadge}>{garment.category}</Text>
            ) : null}
            {garment.color ? <Text style={s.metaBadge}>{garment.color}</Text> : null}
            {garment.size ? <Text style={s.metaBadge}>Tg {garment.size}</Text> : null}
          </View>

          {/* "Aggiungi informazioni" — equivalent to "Descrizione e prezzi"
              from the upload flow. */}
          <View style={s.section}>
            <Text style={s.fieldLabel}>Aggiungi informazioni</Text>
            <Text style={s.fieldHint}>
              Stessa funzione di "Descrizione e prezzi" in caricamento. Es. "Vestito €59, pantalone €67". Se compilato, i prezzi appariranno come piccole etichette nella foto generata (attiva il toggle in Genera o Studio).
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="es. Vestito €59, pantalone €67"
              placeholderTextColor={theme.colors.textMuted}
              style={s.input}
              multiline
              maxLength={300}
              testID="garment-description"
            />
            <Text style={s.charCounter}>{description.length} / 300</Text>
          </View>

          {/* Save button */}
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
            testID="garment-save"
          >
            <LinearGradient
              colors={MAGIC_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[s.saveBtn, saving && { opacity: 0.5 }]}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.saveBtnText}>💾  Salva informazioni</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* Delete button */}
          <TouchableOpacity
            onPress={handleDelete}
            disabled={deleting || saving}
            activeOpacity={0.7}
            style={[s.deleteBtn, (deleting || saving) && { opacity: 0.4 }]}
            testID="garment-delete"
          >
            <Text style={s.deleteBtnText}>
              {deleting ? "Eliminazione…" : "🗑  Elimina capo"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  backArrow: {
    color: theme.colors.text,
    fontSize: 30,
    lineHeight: 30,
    fontWeight: "300",
    marginTop: -2,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  // Scroll body
  scroll: {
    padding: 16,
    gap: 18,
    alignItems: "center",
    paddingBottom: 60,
  },
  imgWrap: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  img: { width: "100%", height: "100%" },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  metaBadge: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.textSecondary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  // Form
  section: {
    width: "100%",
    gap: 6,
  },
  fieldLabel: {
    color: theme.colors.textSecondary,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  fieldHint: {
    color: theme.colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 4,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: "top",
  },
  charCounter: {
    color: theme.colors.textMuted,
    fontSize: 10,
    textAlign: "right",
    marginTop: 2,
  },
  // Buttons
  saveBtn: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  deleteBtn: {
    width: "100%",
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "rgba(225,29,72,0.45)",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  deleteBtnText: {
    color: "#E11D48",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.6,
  },
});
