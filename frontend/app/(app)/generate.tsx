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
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { theme, MAGIC_GRADIENT, AURORA_ANGLE } from "@/src/theme";
import { GradientText, Button, Chip, Card, Badge, PhotoFrame, type as noirType } from "@/src/components/noir";
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
import PromptTweaks, { EMPTY_TWEAKS, hasTweaks, tweaksToPayload, type Tweaks } from "@/src/components/PromptTweaks";

// Aesthetic modifiers shown as a toggle row in the Posa & Look card.
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

// A single toggle chip, restyled with the shared <Chip> primitive but wrapped
// in its own TouchableOpacity so we keep the testID + press handling — <Chip>
// itself doesn't forward testID/onPress-less "display only" usage.
function OptionChip({
  option,
  active,
  onPress,
  testID,
}: {
  option: Option;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} testID={testID}>
      <Chip active={active}>{(option.emoji ? `${option.emoji}  ` : "") + option.label}</Chip>
    </TouchableOpacity>
  );
}

function ChipRow({
  label,
  options,
  value,
  onChange,
  testIDPrefix,
  leading,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  testIDPrefix: string;
  leading?: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={noirType.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
        {leading}
        {options.map((o) => (
          <OptionChip
            key={o.value}
            option={o}
            active={value === o.value}
            onPress={() => onChange(o.value)}
            testID={`${testIDPrefix}-${o.value}`}
          />
        ))}
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
  // Guided per-generation "ritocchi" (togli / cambia colore / sfondo / posa / altro)
  const [tweaks, setTweaks] = useState<Tweaks>(EMPTY_TWEAKS);
  const [tweaksOpen, setTweaksOpen] = useState(false);
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

  // Auto-focus the MOST RECENT garment (the list arrives sorted newest-first).
  // We track the current newest id: on first load, and every time a newly
  // uploaded capo becomes the newest, we RESET the selection to just that capo.
  // This avoids the old bug where a previously-flagged capo stayed selected and
  // got merged with the new one. Skipped when arriving with an explicit
  // ?preselect target (the garment-detail "Salva e genera" flow).
  const lastNewestIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (preselect) return;
    if (garments.length === 0) return;
    const newestId = garments[0].id;
    if (lastNewestIdRef.current === newestId) return; // no new capo → keep selection
    lastNewestIdRef.current = newestId;
    setSelected([newestId]);
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
      // Guided prompt overrides — only sent when the shop owner filled something.
      ...tweaksToPayload(tweaks),
    });
    // I "Ritocchi" sono istruzioni one-shot (es. "cambia colore"): vanno
    // azzerati dopo ogni generazione, altrimenti si trascinano sulla successiva
    // (es. un capo rosso che diventa blu perche il ritocco era rimasto scritto).
    setTweaks(EMPTY_TWEAKS);
    router.push("/generating");
  };

  // ---- derived, display-only state (progress stepper + AI-hint line) ----
  const capiValid = selected.length > 0;
  const modellaValid = Boolean(gender) && Boolean(age); // always true (both have defaults)
  const posaValid = Boolean(pose); // always true (has a default)
  const readyToSubmit = capiValid; // same condition as the CTA
  const stepsCompleted = [capiValid, modellaValid, posaValid, readyToSubmit].filter(Boolean).length;

  const selectedGarmentNames = garments.filter((g) => selected.includes(g.id)).map((g) => g.name);
  const modelHintLabel = presetId && presetName
    ? presetName
    : [AGES.find((a) => a.value === age)?.label, GENDERS.find((g) => g.value === gender)?.label]
        .filter(Boolean)
        .join(" ");
  const hintText = capiValid
    ? `${modelHintLabel || "La modella"} indosserà ${selectedGarmentNames.join(", ")} · ~40 sec`
    : "Seleziona almeno un capo per iniziare.";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <GradientText style={noirType.eyebrow}>MAGIC OUTFIT GENERATOR</GradientText>
        <View style={{ marginTop: 6 }}>
          <Text style={[noirType.display, styles.titleLine]}>Crea il tuo</Text>
          <GradientText style={[noirType.display, styles.titleLine, styles.titleItalic]}>
            servizio fotografico
          </GradientText>
        </View>

        {/* Progress stepper — purely visual, derived from existing selection state. */}
        <View style={styles.stepper}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[
                styles.stepperSeg,
                i < stepsCompleted && styles.stepperSegDone,
                i === stepsCompleted && styles.stepperSegCurrent,
              ]}
            >
              {i < stepsCompleted ? (
                <LinearGradient colors={MAGIC_GRADIENT} {...AURORA_ANGLE} style={StyleSheet.absoluteFillObject} />
              ) : null}
            </View>
          ))}
        </View>

        {/* 1 · Capi */}
        <Card style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={noirType.h2}>1 · Capi</Text>
            <Badge>{selected.length} scelti</Badge>
          </View>
          {garments.length === 0 ? (
            <TouchableOpacity
              style={styles.emptyGarment}
              onPress={() => router.push("/upload")}
              testID="generate-empty-upload"
              activeOpacity={0.85}
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
                    activeOpacity={0.85}
                    testID={`select-garment-${g.id}`}
                  >
                    <PhotoFrame
                      source={{
                        uri: g.thumb_base64
                          ? `data:image/jpeg;base64,${g.thumb_base64}`
                          : `data:image/png;base64,${g.image_base64}`,
                      }}
                      selected={active}
                      dimmed={!active}
                      tagLabel={g.name}
                      style={styles.garmentFrame}
                    />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </Card>

        {/* 2 · Modella */}
        <Card style={styles.card}>
          <Text style={[noirType.h2, { marginBottom: 4 }]}>2 · Modella</Text>
          <ChipRow label="Genere" options={GENDERS} value={gender} onChange={setGender} testIDPrefix="gender" />

          {/* Face-library picker — only when gender = donna (no male
              presets yet). When a face is selected, the demographic chips
              below are hidden because the preset embeds them. */}
          {gender === "donna" && presetId ? (
            <View style={styles.presetRow} testID="preset-selected-card">
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
                <Badge style={{ alignSelf: "flex-start" }}>⭐ Testimonial</Badge>
                <Text style={styles.presetName}>{presetName}</Text>
                <Text style={noirType.micro}>
                  Età, etnia e corporatura sono fissati per coerenza.
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                <TouchableOpacity
                  onPress={() => router.push("/model-picker")}
                  testID="preset-change"
                  activeOpacity={0.75}
                >
                  <Button variant="ghost" small>Cambia</Button>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => presetSelectionStore.clear()}
                  testID="preset-clear"
                  activeOpacity={0.75}
                >
                  <Button variant="ghost" small textStyle={{ color: theme.colors.error }}>Rimuovi</Button>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {/* Demographic chips — hidden when a face preset is locked-in.
              Without a preset the AI uses these to invent the model.
              The "Scegli modella" chip sits inline with the Età options
              (only for donna, where curated face presets exist). */}
          {!(gender === "donna" && presetId) ? (
            <>
              <ChipRow
                label="Età"
                options={AGES}
                value={age}
                onChange={setAge}
                testIDPrefix="age"
                leading={
                  gender === "donna" ? (
                    <TouchableOpacity
                      onPress={() => router.push("/model-picker")}
                      style={styles.modelChip}
                      testID="open-model-picker"
                      activeOpacity={0.85}
                    >
                      <Ionicons name="people-outline" size={14} color={theme.colors.text} />
                      <Text style={styles.modelChipText}>Scegli modella</Text>
                    </TouchableOpacity>
                  ) : null
                }
              />
              <ChipRow label="Corporatura" options={BODIES} value={body} onChange={setBody} testIDPrefix="body" />
              <ChipRow label="Etnia" options={ETHNICITIES} value={eth} onChange={setEth} testIDPrefix="eth" />
            </>
          ) : null}
        </Card>

        {/* 3 · Posa & Look */}
        <Card style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={noirType.h2}>3 · Posa & Look</Text>
            <Text style={noirType.micro}>
              {lookStyles.length > 0 ? `${lookStyles.length} ATTIVI` : "FACOLTATIVO"}
            </Text>
          </View>

          <ChipRow label="Posa" options={POSES} value={pose} onChange={setPose} testIDPrefix="pose" />

          <View style={styles.manageBtnRow}>
            <TouchableOpacity
              onPress={() => router.push("/backgrounds")}
              style={styles.manageBtn}
              testID="generate-manage-backgrounds"
              activeOpacity={0.85}
            >
              <Ionicons name="images-outline" size={12} color={theme.colors.text} />
              <Text style={styles.manageBtnText}>Galleria sfondi</Text>
            </TouchableOpacity>
          </View>

          {/* Custom backgrounds */}
          {customBgs.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={noirType.label}>Sfondi personalizzati</Text>
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
                <Text style={noirType.micro}>
                  ✓ Userai uno sfondo personalizzato. Lo sfondo standard qui sotto sarà ignorato.
                </Text>
              ) : null}
            </View>
          ) : null}

          {!customBgId ? (
            <ChipRow label="Sfondo" options={BACKGROUNDS} value={bg} onChange={setBg} testIDPrefix="bg" />
          ) : null}
          <ChipRow label="Scarpe" options={SHOES} value={shoes} onChange={setShoes} testIDPrefix="shoes" />
          {shoes === "custom" ? (
            <Text style={noirType.micro}>
              👟 La modella indosserà le scarpe presenti nelle foto dei capi, senza sostituirle
              con calzature casual inventate.
            </Text>
          ) : null}

          <View style={{ gap: 8 }}>
            <Text style={noirType.label}>Look</Text>
            <Text style={styles.lookHint}>
              Personalizza l&apos;estetica della foto. Tocca uno o più stili — si combinano tra loro.
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 12 }}>
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
                    activeOpacity={0.85}
                    testID={`look-${ls.id}`}
                  >
                    <Chip active={active}>{`${ls.emoji}  ${ls.label}`}</Chip>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </Card>

        {/* Inserisci prezzi nell'immagine — opt-in toggle. When ON, the
            backend reads the "Descrizione e prezzi" of each selected garment
            (non-auto-placeholder names) and tells Gemini to render price
            tags next to the matching garments. */}
        <Card style={styles.card}>
          <TouchableOpacity
            onPress={() => setAddPriceTags((v) => !v)}
            activeOpacity={0.8}
            style={styles.toggleRow}
            testID="generate-toggle-prices"
          >
            <View style={[styles.checkbox, addPriceTags && styles.checkboxOn]}>
              {addPriceTags ? <Text style={styles.checkboxMark}>✓</Text> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Inserisci prezzi nell&apos;immagine</Text>
              <Text style={noirType.micro}>
                Aggiunge cartellini con i prezzi (presi dalla &quot;Descrizione e prezzi&quot; del capo) accanto ai capi corrispondenti nella foto generata.
              </Text>
            </View>
          </TouchableOpacity>
        </Card>

        {/* Aggiungi accessori — opt-in toggle. When ON, the shop owner can
            attach up to ACCESSORY_MAX extra photos that the AI MUST wear on
            the model. Each photo carries a category that drives a focused
            "worn on the X" instruction in the backend prompt. */}
        <Card style={styles.card}>
          <TouchableOpacity
            onPress={() => {
              setAddAccessories((v) => !v);
              // When toggling OFF we keep the list around so the user can
              // toggle back without losing already-picked accessories.
            }}
            activeOpacity={0.8}
            style={styles.toggleRow}
            testID="generate-toggle-accessories"
          >
            <View style={[styles.checkbox, addAccessories && styles.checkboxOn]}>
              {addAccessories ? <Text style={styles.checkboxMark}>✓</Text> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Aggiungi accessori</Text>
              <Text style={noirType.micro}>
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
        </Card>

        {/* Ritocchi (guided prompt overrides) — collapsed by default. */}
        <Card style={styles.card}>
          <TouchableOpacity
            onPress={() => setTweaksOpen((v) => !v)}
            activeOpacity={0.8}
            style={styles.cardHead}
            testID="generate-tweaks-toggle"
          >
            <Text style={noirType.h2}>🎯 Ritocchi</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={noirType.micro}>{hasTweaks(tweaks) ? "ATTIVI" : "FACOLTATIVI"}</Text>
              <Ionicons
                name={tweaksOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={theme.colors.textSecondary}
              />
            </View>
          </TouchableOpacity>
          {tweaksOpen ? (
            <View style={{ marginTop: 14, gap: 10 }}>
              <Text style={styles.lookHint}>
                Rispondi solo se serve. Lascia vuoto ciò che va già bene.
              </Text>
              <PromptTweaks value={tweaks} onChange={setTweaks} testIdScope="gen-tweaks" />
            </View>
          ) : null}
        </Card>

        {/* Variazioni */}
        <Card style={styles.card}>
          <Text style={[noirType.h2, { marginBottom: 4 }]}>Variazioni</Text>
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
        </Card>

        {/* Provider AI */}
        {providers.length > 0 && (
          <Card style={styles.card}>
            <Text style={[noirType.h2, { marginBottom: 4 }]}>Provider AI</Text>
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
                    <Text style={styles.providerName}>{p.name}</Text>
                    <Text style={styles.providerDesc}>
                      {disabled ? `🔒 ${p.missing_keys?.join(', ')}` : p.description}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Card>
        )}

        {/* Clearance so the last section scrolls fully above the floating CTA
            (which sits at bottom:80 and is ~130px tall). */}
        <View style={{ height: 220 }} />
      </ScrollView>

      {/* Magic button */}
      <View style={styles.ctaWrap}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={onGenerate}
          disabled={!capiValid}
          testID="genera-outfit-button"
        >
          <Button variant="grad" disabled={!capiValid}>
            {`✦ Genera ${variations} scatti`}
          </Button>
        </TouchableOpacity>
        <View style={styles.hintRow}>
          <GradientText style={styles.hintSpark}>✦</GradientText>
          <Text style={styles.hintText} numberOfLines={2}>{hintText}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
  titleLine: { fontSize: 30 },
  titleItalic: { fontStyle: "italic" },
  stepper: { flexDirection: "row", gap: 6, marginTop: 20 },
  stepperSeg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "transparent", borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden" },
  stepperSegCurrent: { borderColor: theme.colors.borderStrong },
  stepperSegDone: { borderWidth: 0 },
  card: { marginTop: 16 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  emptyGarment: {
    borderWidth: 1, borderColor: theme.colors.border, borderStyle: "dashed",
    paddingVertical: 22, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 10,
    borderRadius: theme.radius.md, marginTop: 12,
  },
  emptyGarmentText: { color: theme.colors.text, fontSize: 14 },
  manageBtnRow: { alignItems: "flex-end" },
  manageBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 6, paddingHorizontal: 10,
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
  },
  manageBtnText: {
    color: theme.colors.text, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase",
  },
  customBgRow: { gap: 10, paddingRight: 12 },
  customBg: {
    width: 110, borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, overflow: "hidden",
  },
  customBgActive: { borderColor: `${theme.colors.magic2}66`, borderWidth: 2 },
  customBgImg: { width: "100%", height: 120, resizeMode: "cover" },
  customBgName: { color: theme.colors.textSecondary, fontSize: 11, padding: 8 },
  customBgBadge: {
    position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 11,
    backgroundColor: theme.colors.primary, alignItems: "center", justifyContent: "center",
  },
  garmentRow: { gap: 12, paddingRight: 12, marginTop: 12 },
  garmentFrame: { width: 74, height: 92, borderRadius: 14 },
  varsRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  varBtn: {
    flex: 1, paddingVertical: 16, borderWidth: 1, borderColor: theme.colors.border,
    alignItems: "center", borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
  },
  varBtnActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  varText: { color: theme.colors.text, fontSize: 16, fontWeight: "500" },
  varTextActive: { color: theme.colors.primaryFg },
  lookHint: { color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  modelChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    minHeight: 44, paddingHorizontal: 17, paddingVertical: 11, borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.colors.borderStrong, borderStyle: "dashed",
    backgroundColor: "transparent",
  },
  modelChipText: { color: theme.colors.text, fontSize: 13, fontWeight: "600", letterSpacing: 0.3 },
  toggleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  checkbox: {
    width: 22, height: 22, borderWidth: 1.5, borderRadius: theme.radius.sm - 7,
    borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.bg,
    alignItems: "center", justifyContent: "center", marginTop: 2,
  },
  checkboxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  checkboxMark: { color: theme.colors.primaryFg, fontSize: 14, fontWeight: "900", lineHeight: 16 },
  toggleLabel: { color: theme.colors.text, fontSize: 14, fontWeight: "600", marginBottom: 3 },
  providerChip: {
    padding: 14, borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, minWidth: 200, gap: 6,
    borderRadius: theme.radius.md,
  },
  providerChipActive: { borderColor: theme.colors.text, borderWidth: 2 },
  providerChipDisabled: { opacity: 0.45 },
  providerName: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  providerDesc: { color: theme.colors.textSecondary, fontSize: 10, lineHeight: 14 },
  ctaWrap: {
    position: "absolute", left: 0, right: 0, bottom: 80,
    padding: 20, gap: 10, backgroundColor: theme.colors.bg,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
  },
  hintRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  hintSpark: { fontSize: 12, fontWeight: "700" },
  hintText: { color: theme.colors.textMuted, fontSize: 11, letterSpacing: 0.4, textAlign: "center", flexShrink: 1 },
  presetRow: {
    flexDirection: "row", gap: 12, padding: 12,
    borderWidth: 1, borderColor: `${theme.colors.magic2}66`,
    backgroundColor: theme.colors.surfaceAlt, alignItems: "center", marginTop: 4, borderRadius: theme.radius.md,
  },
  presetThumb: {
    width: 56, height: 84, backgroundColor: theme.colors.bgElevated,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.sm,
  },
  presetName: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
});
