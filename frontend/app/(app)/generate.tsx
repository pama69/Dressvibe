import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api/client";
import { theme, MAGIC_GRADIENT } from "@/src/theme";
import {
  GENDERS,
  AGES,
  BODIES,
  ETHNICITIES,
  POSES,
  BACKGROUNDS,
  SHOES,
  VARIATIONS,
  Option,
} from "@/src/constants/options";
import { genStore, type AccessoryItem } from "@/src/state/genStore";
import { presetSelectionStore } from "@/src/state/presetSelection";
import AccessoryPicker from "@/src/components/AccessoryPicker";

// Aesthetic modifiers shown as a 5-button toggle row in Step 4 (Look).
// IDs must match the LOOK_STYLES_PROMPTS dict on the backend (server.py).
type LookStyle = { id: string; label: string; emoji: string };
const LOOK_STYLES: LookStyle[] = [
  { id: "warm",    label: "Caldo",    emoji: "🔆" },
  { id: "depth",   label: "Profondo", emoji: "🎯" },
  { id: "vivid",   label: "Vivido",   emoji: "🎨" },
  { id: "dynamic", label: "Dinamico", emoji: "💨" },
  { id: "premium", label: "Premium",  emoji: "💎" },
];

type Garment = { id: string; name: string; image_base64?: string; thumb_base64?: string; category: string };

function ChipRow({
  label,
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  testIDPrefix: string;
}) {
  return (
    <View style={chipStyles.wrap}>
      <Text style={chipStyles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={chipStyles.row}>
        {options.map((o) => {
          const active = value === o.value;
          return (
            <TouchableOpacity
              key={o.value}
              onPress={() => onChange(o.value)}
              style={[chipStyles.chip, active && chipStyles.chipActive]}
              testID={`${testIDPrefix}-${o.value}`}
              activeOpacity={0.8}
            >
              <Text style={[chipStyles.chipText, active && chipStyles.chipTextActive]}>
                {o.emoji ? `${o.emoji}  ` : ""}{o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function Generate() {
  const router = useRouter();
  // Optional ?preselect=<garment_id> in the URL — when present, that garment
  // is automatically marked as selected the first time the list loads.
  // Used by the gallery → garment detail → "Salva e genera" flow.
  const { preselect } = useLocalSearchParams<{ preselect?: string }>();
  const preselectAppliedRef = useRef(false);
  const [garments, setGarments] = useState<Garment[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  const [gender, setGender] = useState("donna");
  const [age, setAge] = useState("adulto");
  const [body, setBody] = useState("slim");
  const [eth, setEth] = useState("caucasica");
  const [pose, setPose] = useState("casual_standing");
  const [bg, setBg] = useState("white_studio");
  const [shoes, setShoes] = useState("comoda_fashion");
  const [variations, setVariations] = useState(4);
  const [lookStyles, setLookStyles] = useState<string[]>([]);
  const [addPriceTags, setAddPriceTags] = useState(false);
  // Aggiungi accessori — when the checkbox is on, the shop owner can attach
  // up to ACCESSORY_MAX extra photos (shoes, bags, jewelry, hats, glasses,
  // belts, scarves, etc.) that the AI MUST include in the generated photo.
  // Each entry has a category that drives a focused, per-body-part prompt
  // addendum on the backend (see ACCESSORY_CAT_INSTRUCTION in server.py).
  const [addAccessories, setAddAccessories] = useState(false);
  const [accessories, setAccessories] = useState<AccessoryItem[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [aiProvider, setAiProvider] = useState<string>("gemini_nano_banana");
  const [customBgs, setCustomBgs] = useState<{ id: string; name: string; description?: string; image_base64: string }[]>([]);
  const [customBgId, setCustomBgId] = useState<string | null>(null);

  // Selected model preset (face library). When set, etnia/corporatura/età
  // are hidden, body is forced to slim, and the preset's face description is
  // injected server-side into the generation prompt. `presetThumb` is shown
  // in the picker chip so the shop owner sees who they picked.
  const [presetId, setPresetId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState<string | null>(null);
  const [presetThumb, setPresetThumb] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listGarments();
      setGarments(list);
      try {
        const pv = await api.listProviders();
        setProviders(pv.image_gen || []);
      } catch {}
      try {
        const bgs = await api.listBackgrounds();
        setCustomBgs(bgs as any);
      } catch {}
    } catch (e) {
      console.warn(e);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  // Sync to preset selection changes coming from the model picker screen.
  // We also re-read on focus so the chip refreshes when navigating back.
  useEffect(() => {
    const apply = () => {
      const sel = presetSelectionStore.get();
      if (sel) {
        setPresetId(sel.id);
        setPresetName(sel.name);
        setPresetThumb(sel.thumb_base64);
      } else {
        setPresetId(null);
        setPresetName(null);
        setPresetThumb(null);
      }
    };
    apply();
    return presetSelectionStore.subscribe(apply);
  }, []);

  // Switching back to gender = uomo (no presets available) clears any female
  // preset selection so we don't end up generating a male model with a female
  // face description still attached.
  useEffect(() => {
    if (gender !== "donna" && presetId) {
      presetSelectionStore.clear();
    }
  }, [gender, presetId]);

  // Apply ?preselect=<garment_id> once after the garment list loads.
  // This makes the "Salva e genera" button on the garment detail screen
  // land here with the right capo already ticked, so the shop owner can
  // continue immediately with model / scene / look choices.
  useEffect(() => {
    if (preselectAppliedRef.current) return;
    if (!preselect || garments.length === 0) return;
    const exists = garments.some((g) => g.id === preselect);
    if (!exists) return;
    setSelected((curr) => (curr.includes(preselect) ? curr : [...curr, preselect]));
    preselectAppliedRef.current = true;
  }, [garments, preselect]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const onGenerate = () => {
    if (selected.length === 0) {
      Alert.alert("Seleziona almeno un capo", "Tocca uno o più capi dalla tua galleria per continuare.");
      return;
    }
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    genStore.set({
      garment_ids: selected,
      model_gender: gender,
      model_age: age,
      // Force slim body when a face preset is locked-in (also enforced
      // server-side; the duplication here keeps the request consistent).
      model_body: presetId ? "slim" : body,
      model_ethnicity: eth,
      pose,
      background: bg,
      shoes,
      num_variations: variations,
      provider: aiProvider,
      custom_background_id: customBgId || undefined,
      look_styles: lookStyles.length > 0 ? lookStyles : undefined,
      add_price_tags: addPriceTags || undefined,
      // Only ship the accessory list when (a) the checkbox is on AND
      // (b) at least one accessory was actually picked. Otherwise we
      // send `undefined` so the backend prompt stays untouched.
      accessories:
        addAccessories && accessories.length > 0 ? accessories : undefined,
      model_preset_id: presetId || undefined,
      model_preset_name: presetName || undefined,
      model_preset_thumb: presetThumb || undefined,
    });
    router.push("/generating");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>MAGIC OUTFIT GENERATOR</Text>
        <Text style={styles.title}>Crea il tuo{"\n"}servizio fotografico.</Text>

        {/* Step 1 - garments */}
        <View style={styles.step}>
          <View style={styles.stepHead}>
            <Text style={styles.stepLabel}>1 — Capi</Text>
            <Text style={styles.stepHint}>{selected.length} selezionati</Text>
          </View>
          {garments.length === 0 ? (
            <TouchableOpacity
              style={styles.emptyGarment}
              onPress={() => router.push("/upload")}
              testID="generate-empty-upload"
            >
              <Ionicons name="cloud-upload-outline" size={20} color={theme.colors.text} />
              <Text style={styles.emptyGarmentText}>Carica il tuo primo capo</Text>
            </TouchableOpacity>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.garmentRow}>
              {garments.map((g) => {
                const active = selected.includes(g.id);
                return (
                  <TouchableOpacity
                    key={g.id}
                    onPress={() => toggle(g.id)}
                    style={[styles.garment, active && styles.garmentActive]}
                    activeOpacity={0.85}
                    testID={`select-garment-${g.id}`}
                  >
                    <Image
                      source={{
                        uri: g.thumb_base64
                          ? `data:image/jpeg;base64,${g.thumb_base64}`
                          : `data:image/png;base64,${g.image_base64}`,
                      }}
                      style={styles.garmentImg}
                    />
                    {active && (
                      <View style={styles.checkBadge}>
                        <Ionicons name="checkmark" size={14} color={theme.colors.primaryFg} />
                      </View>
                    )}
                    <Text style={styles.garmentName} numberOfLines={1}>{g.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* Step 2 — Model */}
        <View style={styles.step}>
          <Text style={styles.stepLabel}>2 — Modello</Text>
          <ChipRow label="Genere" options={GENDERS} value={gender} onChange={setGender} testIDPrefix="gender" />

          {/* Face-library picker — only when gender = donna (no male
              presets yet). When a face is selected, the demographic chips
              below are hidden because the preset embeds them. */}
          {gender === "donna" ? (
            presetId ? (
              <View style={styles.presetCard} testID="preset-selected-card">
                {presetThumb ? (
                  <Image
                    source={{ uri: `data:image/jpeg;base64,${presetThumb}` }}
                    style={styles.presetThumb}
                  />
                ) : (
                  <View style={[styles.presetThumb, { alignItems: "center", justifyContent: "center" }]}>
                    <Text style={{ color: theme.colors.textMuted, fontSize: 18 }}>👤</Text>
                  </View>
                )}
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.presetLabel}>Modella scelta</Text>
                  <Text style={styles.presetName}>{presetName}</Text>
                  <Text style={styles.presetHint}>
                    Età, etnia e corporatura sono fissati per coerenza.
                  </Text>
                </View>
                <View style={{ gap: 6 }}>
                  <TouchableOpacity
                    onPress={() => router.push("/model-picker")}
                    style={styles.presetChange}
                    testID="preset-change"
                    activeOpacity={0.75}
                  >
                    <Text style={styles.presetChangeText}>Cambia</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => presetSelectionStore.clear()}
                    style={styles.presetClear}
                    testID="preset-clear"
                    activeOpacity={0.75}
                  >
                    <Text style={styles.presetClearText}>Rimuovi</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => router.push("/model-picker")}
                style={styles.pickModelBtn}
                testID="open-model-picker"
                activeOpacity={0.85}
              >
                <Ionicons name="people-outline" size={16} color={theme.colors.text} />
                <Text style={styles.pickModelBtnText}>Scegli modella</Text>
                <Text style={styles.pickModelBtnHint}>15 volti curati • opzionale</Text>
              </TouchableOpacity>
            )
          ) : null}

          {/* Demographic chips — hidden when a face preset is locked-in.
              Without a preset the AI uses these to invent the model. */}
          {!(gender === "donna" && presetId) ? (
            <>
              <ChipRow label="Età" options={AGES} value={age} onChange={setAge} testIDPrefix="age" />
              <ChipRow label="Corporatura" options={BODIES} value={body} onChange={setBody} testIDPrefix="body" />
              <ChipRow label="Etnia" options={ETHNICITIES} value={eth} onChange={setEth} testIDPrefix="eth" />
            </>
          ) : null}
        </View>

        {/* Step 3 — Scene */}
        <View style={styles.step}>
          <View style={styles.stepHead}>
            <Text style={styles.stepLabel}>3 — Scena</Text>
            <TouchableOpacity
              onPress={() => router.push("/backgrounds")}
              style={styles.bgManageBtn}
              testID="generate-manage-backgrounds"
            >
              <Ionicons name="images-outline" size={12} color={theme.colors.text} />
              <Text style={styles.bgManageText}>Galleria sfondi</Text>
            </TouchableOpacity>
          </View>
          <ChipRow label="Posa" options={POSES} value={pose} onChange={setPose} testIDPrefix="pose" />

          {/* Custom backgrounds */}
          {customBgs.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Text style={styles.customBgLabel}>Sfondi personalizzati</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.customBgRow}>
                {customBgs.map((b) => {
                  const active = customBgId === b.id;
                  return (
                    <TouchableOpacity
                      key={b.id}
                      onPress={() => setCustomBgId(active ? null : b.id)}
                      style={[styles.customBg, active && styles.customBgActive]}
                      activeOpacity={0.85}
                      testID={`select-custom-bg-${b.id}`}
                    >
                      <Image source={{ uri: `data:image/png;base64,${b.image_base64}` }} style={styles.customBgImg} />
                      {active ? (
                        <View style={styles.customBgBadge}>
                          <Ionicons name="checkmark" size={14} color={theme.colors.primaryFg} />
                        </View>
                      ) : null}
                      <Text style={styles.customBgName} numberOfLines={1}>{b.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              {customBgId ? (
                <Text style={styles.customBgHint}>
                  ✓ Userai uno sfondo personalizzato. Lo sfondo standard qui sotto sarà ignorato.
                </Text>
              ) : null}
            </View>
          ) : null}

          {!customBgId ? (
            <ChipRow label="Sfondo" options={BACKGROUNDS} value={bg} onChange={setBg} testIDPrefix="bg" />
          ) : null}
          <ChipRow label="Scarpe" options={SHOES} value={shoes} onChange={setShoes} testIDPrefix="shoes" />
        </View>

        {/* Step 4 — Look (aesthetic modifiers) */}
        <View style={styles.step}>
          <View style={styles.stepHead}>
            <Text style={styles.stepLabel}>4 — Look</Text>
            <Text style={styles.stepHint}>{lookStyles.length > 0 ? `${lookStyles.length} attivi` : "facoltativo"}</Text>
          </View>
          <Text style={styles.lookHint}>
            Personalizza l&apos;estetica della foto. Tocca uno o più stili — si combinano tra loro.
          </Text>
          <View style={styles.lookGrid}>
            {LOOK_STYLES.map((ls) => {
              const active = lookStyles.includes(ls.id);
              return (
                <TouchableOpacity
                  key={ls.id}
                  onPress={() => {
                    try { Haptics.selectionAsync(); } catch {}
                    setLookStyles((curr) =>
                      curr.includes(ls.id) ? curr.filter((x) => x !== ls.id) : [...curr, ls.id]
                    );
                  }}
                  style={[styles.lookBtn, active && styles.lookBtnActive]}
                  activeOpacity={0.85}
                  testID={`look-${ls.id}`}
                >
                  <Text style={[styles.lookEmoji, active && styles.lookEmojiActive]}>{ls.emoji}</Text>
                  <Text style={[styles.lookLabel, active && styles.lookLabelActive]}>{ls.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Inserisci prezzi nell'immagine — opt-in toggle. When ON, the
            backend reads the "Descrizione e prezzi" of each selected garment
            (non-auto-placeholder names) and tells Gemini to render price
            tags next to the matching garments. */}
        <View style={styles.step}>
          <TouchableOpacity
            onPress={() => setAddPriceTags((v) => !v)}
            activeOpacity={0.8}
            style={styles.priceToggleRow}
            testID="generate-toggle-prices"
          >
            <View style={[styles.checkbox, addPriceTags && styles.checkboxOn]}>
              {addPriceTags ? <Text style={styles.checkboxMark}>✓</Text> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.priceToggleLabel}>Inserisci prezzi nell&apos;immagine</Text>
              <Text style={styles.priceToggleHint}>
                Aggiunge cartellini con i prezzi (presi dalla &quot;Descrizione e prezzi&quot; del capo) accanto ai capi corrispondenti nella foto generata.
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Aggiungi accessori — opt-in toggle. When ON, the shop owner can
            attach up to ACCESSORY_MAX extra photos that the AI MUST wear on
            the model. Each photo carries a category that drives a focused
            "worn on the X" instruction in the backend prompt. */}
        <View style={styles.step}>
          <TouchableOpacity
            onPress={() => {
              setAddAccessories((v) => !v);
              // When toggling OFF we keep the list around so the user can
              // toggle back without losing already-picked accessories.
            }}
            activeOpacity={0.8}
            style={styles.priceToggleRow}
            testID="generate-toggle-accessories"
          >
            <View style={[styles.checkbox, addAccessories && styles.checkboxOn]}>
              {addAccessories ? <Text style={styles.checkboxMark}>✓</Text> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.priceToggleLabel}>Aggiungi accessori</Text>
              <Text style={styles.priceToggleHint}>
                Carica foto di scarpe, borse, gioielli, cappelli, occhiali ecc. che la modella DEVE indossare nella foto generata.
              </Text>
            </View>
          </TouchableOpacity>

          {addAccessories ? (
            <AccessoryPicker
              enabled={addAccessories}
              items={accessories}
              setItems={setAccessories}
              testIdScope="acc-gen"
            />
          ) : null}
        </View>

        {/* Step 5 — Variations */}
        <View style={styles.step}>
          <Text style={styles.stepLabel}>5 — Variazioni</Text>
          <View style={styles.varsRow}>
            {VARIATIONS.map((n) => {
              const active = variations === n;
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => setVariations(n)}
                  style={[styles.varBtn, active && styles.varBtnActive]}
                  testID={`var-${n}`}
                >
                  <Text style={[styles.varText, active && styles.varTextActive]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Step 5 — AI provider */}
        {providers.length > 0 && (
          <View style={styles.step}>
            <Text style={styles.stepLabel}>6 — Provider AI</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
              {providers.map((p) => {
                const active = aiProvider === p.id;
                const disabled = !p.enabled;
                return (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => !disabled && setAiProvider(p.id)}
                    disabled={disabled}
                    style={[
                      styles.providerChip,
                      active && styles.providerChipActive,
                      disabled && styles.providerChipDisabled,
                    ]}
                    testID={`provider-${p.id}`}
                  >
                    <Text style={[styles.providerName, active && styles.providerNameActive]}>
                      {p.name}
                    </Text>
                    <Text style={styles.providerDesc}>
                      {disabled ? `🔒 ${p.missing_keys?.join(', ')}` : p.description}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Magic button */}
      <View style={styles.ctaWrap}>
        <TouchableOpacity activeOpacity={0.9} onPress={onGenerate} testID="genera-outfit-button">
          <LinearGradient
            colors={MAGIC_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cta}
          >
            <Ionicons name="sparkles" size={20} color="#fff" />
            <Text style={styles.ctaText}>Genera Outfit Realistico</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 },
  eyebrow: { color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 3 },
  title: { color: theme.colors.text, fontSize: 30, lineHeight: 34, fontWeight: "300", letterSpacing: -1, marginTop: 6 },
  step: { marginTop: 28, gap: 12 },
  stepHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stepLabel: { color: theme.colors.text, fontSize: 12, letterSpacing: 2, textTransform: "uppercase" },
  stepHint: { color: theme.colors.textSecondary, fontSize: 11 },
  emptyGarment: {
    borderWidth: 1, borderColor: theme.colors.border, borderStyle: "dashed",
    paddingVertical: 22, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 10,
    borderRadius: 12,
  },
  emptyGarmentText: { color: theme.colors.text, fontSize: 14 },
  bgManageBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 6, paddingHorizontal: 10,
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 8,
  },
  bgManageText: {
    color: theme.colors.text, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase",
  },
  customBgLabel: {
    color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 2,
    textTransform: "uppercase",
  },
  customBgRow: { gap: 10, paddingRight: 12 },
  customBg: {
    width: 110, borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: "#fff", borderRadius: 12, overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  customBgActive: { borderColor: theme.colors.text, borderWidth: 2 },
  customBgImg: { width: "100%", height: 120, resizeMode: "cover", borderTopLeftRadius: 11, borderTopRightRadius: 11 },
  customBgName: { color: theme.colors.textSecondary, fontSize: 11, padding: 8 },
  customBgBadge: {
    position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 11,
    backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center",
  },
  customBgHint: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  garmentRow: { gap: 12, paddingRight: 12 },
  garment: {
    width: 110, borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: "#fff", borderRadius: 12, overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  garmentActive: { borderColor: theme.colors.text, borderWidth: 2 },
  garmentImg: { width: "100%", height: 120, borderTopLeftRadius: 11, borderTopRightRadius: 11 },
  garmentName: { color: theme.colors.textSecondary, fontSize: 11, padding: 8 },
  checkBadge: {
    position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 11,
    backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center",
  },
  varsRow: { flexDirection: "row", gap: 10 },
  varBtn: {
    flex: 1, paddingVertical: 16, borderWidth: 1, borderColor: theme.colors.border,
    alignItems: "center", borderRadius: 12,
    shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
    backgroundColor: theme.colors.surface,
  },
  varBtnActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  varText: { color: theme.colors.text, fontSize: 16, fontWeight: "500" },
  varTextActive: { color: theme.colors.primaryFg },
  lookHint: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: -4 },
  lookGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  lookBtn: {
    flexBasis: "31%", flexGrow: 1,
    paddingVertical: 12, paddingHorizontal: 10,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: "center", justifyContent: "center", gap: 4,
    minWidth: 90, borderRadius: 12,
    shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  lookBtnActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  lookEmoji: { fontSize: 20 },
  lookEmojiActive: {},
  lookLabel: { color: theme.colors.text, fontSize: 12, fontWeight: "600", letterSpacing: 0.3 },
  lookLabelActive: { color: theme.colors.primaryFg },
  priceToggleRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, borderRadius: 12,
    shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  checkbox: {
    width: 22, height: 22, borderWidth: 1.5, borderRadius: 6,
    borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.bg,
    alignItems: "center", justifyContent: "center", marginTop: 2,
  },
  checkboxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  checkboxMark: { color: theme.colors.primaryFg, fontSize: 14, fontWeight: "900", lineHeight: 16 },
  priceToggleLabel: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  priceToggleHint: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  accBox: {
    marginTop: 8, gap: 12, padding: 14,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, borderRadius: 12,
  },
  accSubLabel: { color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 2, textTransform: "uppercase" },
  accBtnRow: { flexDirection: "row", gap: 10 },
  accBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 12, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.border,
    backgroundColor: theme.colors.bg, borderRadius: 10,
  },
  accBtnText: { color: theme.colors.text, fontSize: 13, fontWeight: "600", letterSpacing: 0.3 },
  accEmpty: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, fontStyle: "italic" },
  accThumbWrap: {
    width: 90, height: 110, backgroundColor: "#fff",
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
    overflow: "hidden", position: "relative",
  },
  accThumb: { width: "100%", height: 80 },
  accThumbLabelWrap: { paddingHorizontal: 6, paddingVertical: 4, borderTopWidth: 1, borderTopColor: theme.colors.border },
  accThumbLabel: { color: theme.colors.text, fontSize: 10, letterSpacing: 0.2 },
  accRemoveBtn: {
    position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.3)",
  },
  providerChip: {
    padding: 14, borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, minWidth: 200, gap: 6,
    borderRadius: 12,
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  providerChipActive: { borderColor: theme.colors.text, borderWidth: 2 },
  providerChipDisabled: { opacity: 0.45 },
  providerName: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  providerNameActive: { color: theme.colors.text },
  providerDesc: { color: theme.colors.textSecondary, fontSize: 10, lineHeight: 14 },
  ctaWrap: {
    position: "absolute", left: 0, right: 0, bottom: 80,
    padding: 20, backgroundColor: theme.colors.bg,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
  },
  cta: {
    paddingVertical: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12,
    borderRadius: 16,
    shadowColor: "#E11D48", shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700", letterSpacing: 0.6 },
  pickModelBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 14, paddingHorizontal: 16,
    borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, marginTop: 4, borderRadius: 12,
  },
  pickModelBtnText: { color: theme.colors.text, fontSize: 13, fontWeight: "600", letterSpacing: 0.3 },
  pickModelBtnHint: { color: theme.colors.textMuted, fontSize: 11, marginLeft: "auto" },
  presetCard: {
    flexDirection: "row", gap: 12, padding: 12,
    borderWidth: 1, borderColor: theme.colors.text,
    backgroundColor: theme.colors.surface, alignItems: "center", marginTop: 4, borderRadius: 12,
  },
  presetThumb: {
    width: 56, height: 84, backgroundColor: "#111",
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8,
  },
  presetLabel: { color: theme.colors.textMuted, fontSize: 9, letterSpacing: 2, textTransform: "uppercase" },
  presetName: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  presetHint: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 14 },
  presetChange: {
    paddingVertical: 6, paddingHorizontal: 10,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.bg, borderRadius: 8,
  },
  presetChangeText: { color: theme.colors.text, fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  presetClear: {
    paddingVertical: 6, paddingHorizontal: 10,
    borderWidth: 1, borderColor: theme.colors.error, borderRadius: 8,
  },
  presetClearText: { color: theme.colors.error, fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
});

const chipStyles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 2, textTransform: "uppercase" },
  row: { gap: 8, paddingRight: 12 },
  chip: {
    paddingVertical: 10, paddingHorizontal: 16,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, borderRadius: 20,
  },
  chipActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  chipText: { color: theme.colors.text, fontSize: 13, letterSpacing: 0.3 },
  chipTextActive: { color: theme.colors.primaryFg, fontWeight: "600" },
});
