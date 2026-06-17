import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { theme, MAGIC_GRADIENT } from "@/src/theme";
import VideoCard from "@/src/components/VideoCard";
import InstagramShareSheet from "@/src/components/InstagramShareSheet";
import { shareToInstagram, shareGeneric } from "@/src/utils/share";
import { saveImageToGallery, saveVideoToGallery } from "@/src/utils/gallery";
import { useNotify } from "@/src/contexts/ConfirmContext";

const QUICK_EDITS = [
  { label: "Rimuovi sfondo", prompt: "Remove the background completely and replace it with a clean white studio background." },
  { label: "Sfondo spiaggia", prompt: "Change the background to a sunny beach at golden hour with soft sea bokeh." },
  { label: "Sfondo strada", prompt: "Change the background to a fashionable European city street with soft bokeh." },
  { label: "Sfondo nero", prompt: "Replace the background with a pure black studio backdrop, cinematic lighting." },
];

// Aesthetic "look" presets — same 5 styles offered in the Generation panel,
// re-framed here as edit prompts that re-render the existing photo while
// keeping the subject (model, outfit, pose, composition) untouched.
const LOOK_PRESETS: { id: string; label: string; emoji: string; prompt: string }[] = [
  {
    id: "warm", label: "Caldo", emoji: "🔆",
    prompt:
      "Re-render this photo with warm, soft natural lighting coming from a side window: gentle golden-hour glow, soft volume on the body and fabric, light natural shadows, realistic depth, elegant lifestyle look. KEEP the model, outfit, pose, framing and overall composition EXACTLY the same — only change the lighting and color mood.",
  },
  {
    id: "depth", label: "Profondo", emoji: "🎯",
    prompt:
      "Re-render this photo as if shot from a slightly lower three-quarter angle, with a natural perspective that elongates the figure. Add gentle background bokeh (shallow depth of field) and a clean professional modern look. KEEP the model, outfit and pose EXACTLY the same — only modify the apparent angle and background blur.",
  },
  {
    id: "vivid", label: "Vivido", emoji: "🎨",
    prompt:
      "Re-grade this photo with vivid, fabric-faithful colors and balanced contrast: rich but realistic tones, soft diffused light that brings out the texture of the fabric, fresh commercial atmosphere, premium photo quality. KEEP the model, outfit, pose and composition EXACTLY the same — only change the color grading and tonal balance.",
  },
  {
    id: "dynamic", label: "Dinamico", emoji: "💨",
    prompt:
      "Re-render this photo adding subtle natural movement: hair or fabric gently moving in a soft breeze, positive flowing energy, natural light, real-life feel without exaggeration, clean editorial style. KEEP the model, outfit and overall framing EXACTLY the same — only add the subtle motion and energy.",
  },
  {
    id: "premium", label: "Premium", emoji: "💎",
    prompt:
      "Re-render this photo with a minimal setting and slightly blurred neutral background, elegant yet warm studio lighting, balanced composition, high-end fashion catalog look — very appealing for social media. KEEP the model, outfit and pose EXACTLY the same — only change the background and lighting style.",
  },
];

export default function Studio() {
  const { id, index } = useLocalSearchParams<{ id: string; index: string }>();
  const router = useRouter();
  const notify = useNotify();
  const initialIdx = parseInt(index || "0", 10);
  // Live image index: starts from the URL param, but is BUMPED to the new
  // gallery position every time the user applies an edit (since
  // /studio/edit appends the result with $push). Keeping this in sync is
  // critical so subsequent shares (Telegram URL button, WhatsApp short
  // link, gallery save) always reference the IMAGE THE USER IS SEEING,
  // not the original at the old index.
  const [idx, setIdx] = useState<number>(initialIdx);

  const [image, setImage] = useState<string | null>(null);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [edited, setEdited] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [caption, setCaption] = useState("");
  const [capBusy, setCapBusy] = useState(false);
  const [genTitle, setGenTitle] = useState("");
  const [videoProviders, setVideoProviders] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [tgDescription, setTgDescription] = useState("");
  const [publishingTgVideoId, setPublishingTgVideoId] = useState<string | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [igSheet, setIgSheet] = useState<{ image?: string; video?: string; skipSave?: boolean } | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  // "Inserisci prezzi nell'immagine" — when ON, every edit/look call passes
  // add_price_tags=true so the backend looks up the source generation's
  // garment descriptions and tells Gemini to overlay price tags.
  const [addPriceTags, setAddPriceTags] = useState(false);
  // Selected aesthetic preset (from the "Cambia look" 5-button row).
  // Tapping a chip only SELECTS it visually — the user must then press
  // "Applica modifica" to actually run the edit.
  const [selectedLookId, setSelectedLookId] = useState<string | null>(null);

  /** When the user taps the Instagram button we immediately save the active
   * image into the device gallery so they don't have to wait until the
   * caption modal is confirmed. The modal will skip its own save thanks to
   * the `skipSave` flag we pass through. */
  const openInstagramShare = async () => {
    if (!image) return;
    const saved = await saveImageToGallery(image, `dressvibe_${id}_${idx}`);
    if (Platform.OS !== "web" && saved.ok && saved.where === "gallery") {
      // Silent on success — modal already gives feedback. We just want the
      // file to be in the gallery by the time the modal asks "open Instagram".
    } else if (Platform.OS !== "web" && !saved.ok && saved.error?.includes("Permesso")) {
      notify({ title: "Permesso galleria", message: "Per salvare le foto nella galleria devi concedere il permesso a DressVibe nelle impostazioni del telefono." });
    }
    setIgSheet({ image, skipSave: saved.ok });
  };

  const shareToWhatsApp = async () => {
    if (!id || waBusy) return;
    setWaBusy(true);
    try {
      // Read the user's configured WhatsApp channel FIRST. If not set we bail
      // out early and don't even bother creating a short link.
      let channelUrl = "";
      try {
        const settings = await api.getUserSettings();
        channelUrl = (settings.whatsapp_channel_url || "").trim();
      } catch {}
      if (!channelUrl) {
        await notify({
          title: "Canale WhatsApp non configurato",
          message: "Vai in Profilo → Canale WhatsApp e incolla il link del tuo canale.",
        });
        return;
      }

      // Generate (or reuse) a short public link for this look + image
      const link = await api.createShortLink({
        gen_id: id,
        image_index: idx,
        look_name: genTitle || "Look DressVibe",
      });

      // Save the active image to the device gallery (Photos on iOS, "DressVibe"
      // album on Android). On web this falls back to a normal Download. Doing it
      // *before* opening WhatsApp means by the time the channel opens, the file
      // is already in the user's gallery ready to attach.
      const saved = await saveImageToGallery(image || "", `dressvibe_${id}_${idx}`);

      // Copy a polished message with the dicitura on top + a description
      // (from "Descrizione Post" field) when set + the public link.
      // We use the long canonical URL — TinyURL was removed because their
      // landing page now shows third-party ads.
      const shareUrl = link.public_url;
      const desc = (tgDescription || "").trim();
      const clipboardText = (desc ? `${desc}\n\n` : "") +
        `👇 Premi qui per ricevere info 👇\n${shareUrl}`;
      try { await Clipboard.setStringAsync(clipboardText); } catch {}

      // Open WhatsApp:
      // - Mobile native (iOS/Android via Expo Go or build): try Linking.openURL
      //   directly without `canOpenURL` — canOpenURL needs LSApplicationQueriesSchemes
      //   on iOS for https URLs and returns false in Expo Go, blocking the open.
      // - Web inside the Emergent preview iframe: a programmatic `<a target="_blank">`
      //   click is treated as a user gesture and bypasses the iframe COOP/COEP
      //   restrictions that block `window.open`. The WA universal link then
      //   hands off to the installed WhatsApp app on the device.
      let opened = false;
      if (Platform.OS === "web") {
        try {
          if (typeof document !== "undefined") {
            const a = document.createElement("a");
            a.href = channelUrl;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { try { a.remove(); } catch {} }, 1000);
            opened = true;
          }
        } catch {}
      } else {
        try {
          await Linking.openURL(channelUrl);
          opened = true;
        } catch (err) {
          // Last-ditch: try the wa.me universal link form which iOS reliably
          // hands off to the WhatsApp app even when canOpenURL says no.
          try {
            await Linking.openURL(channelUrl.replace("whatsapp.com/channel/", "wa.me/channel/"));
            opened = true;
          } catch {}
        }
      }

      const savedMsg = saved.ok
        ? (saved.where === "gallery" ? "📸 Foto salvata nella galleria.\n" : "📥 Foto scaricata.\n")
        : "";

      if (opened) {
        await notify({
          title: "Pronto per WhatsApp ✅",
          message: savedMsg +
            (desc ? `Testo:\n${desc}\n\n` : "") +
            `Link copiato:\n${shareUrl}\n\n` +
            "Nel canale: nuovo post → allega la foto dalla galleria → incolla.",
        });
      } else {
        await notify({
          title: "Apri WhatsApp manualmente",
          message: savedMsg +
            (Platform.OS === "web"
              ? `Il browser blocca l'apertura automatica di WhatsApp dalla preview Emergent. ` +
                `Apri WhatsApp manualmente (mobile o web) → entra nel tuo canale → nuovo post → incolla.\n\n` +
                `Testo già negli appunti:\n` +
                (desc ? `${desc}\n\n` : "") +
                `👇 Premi qui per ricevere info 👇\n${shareUrl}`
              : `Non sono riuscito ad aprire WhatsApp automaticamente.\n\nCanale: ${channelUrl}\n\nTesto copiato:\n` +
                (desc ? `${desc}\n\n` : "") +
                `👇 Premi qui per ricevere info 👇\n${shareUrl}`),
        });
      }
    } catch (e: any) {
      notify({ title: "Errore", message: e?.message || "Impossibile creare il link" });
    } finally {
      setWaBusy(false);
    }
  };

  const loadVideos = useCallback(async () => {
    if (!id) return;
    try {
      const v = await api.listGenerationVideos(id);
      setVideos(v || []);
    } catch (e) {
      // non-fatal
      console.warn("loadVideos", e);
    }
  }, [id]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const g = await api.getGeneration(id);
      const img = g.images?.[idx];
      setImage(img || null);
      setOriginalImage(img || null);
      setGenTitle(g.title || "");
    } catch (e: any) {
      notify({ title: "Errore", message: e?.message || "Errore" });
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, idx, router]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadVideos(); }, [loadVideos]);

  // Sync local `idx` with the URL `index` param. We use useFocusEffect (not
  // a plain useEffect on [index, id]) because the URL `index` value can be
  // IDENTICAL between two visits to this screen — e.g., the user opens
  // image 0, edits it (idx is bumped to 5 locally, URL still says 0),
  // goes back to the results gallery, and taps image 0 again. The URL
  // doesn't change, so a [index, id] effect never fires and the screen
  // stays stuck on image 5 ("doesn't let me select previous creations,
  // only the last one"). useFocusEffect re-runs every time the user
  // returns to this screen so we always re-anchor idx to the URL value.
  useFocusEffect(
    useCallback(() => {
      const next = parseInt(index || "0", 10);
      if (!Number.isNaN(next)) {
        setIdx((curr) => (curr !== next ? next : curr));
        setEdited(false);
      }
    }, [index, id])
  );

  useEffect(() => {
    (async () => {
      try {
        const pv = await api.listProviders();
        setVideoProviders(pv.video_gen || []);
      } catch {}
    })();
  }, []);

  const applyEdit = async (prompt: string) => {
    // The studio_edit backend requires a non-empty edit_prompt. When the
    // user is only toggling "Inserisci prezzi nell'immagine" (no custom
    // text and no look selected) we send a neutral instruction so the
    // backend's price-tags suffix is the only meaningful change.
    const finalPrompt = (prompt && prompt.trim()) || "Keep the photo unchanged.";
    if (!image) return;
    setBusy(true);
    try {
      const res = await api.studioEdit(image, finalPrompt, id, addPriceTags);
      setImage(res.image_base64);
      setEdited(true);
      // Bump local index to the just-appended position so subsequent
      // shares (Telegram URL button, WhatsApp short link, gallery save)
      // reference the edited image, not the original at the old idx.
      if (typeof res.image_index === "number" && res.image_index >= 0) {
        setIdx(res.image_index);
      }
    } catch (e: any) {
      notify({ title: "Modifica non riuscita", message: e?.message || "Riprova" });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Build the final edit prompt by combining the user's custom text and the
   * selected "Cambia look" preset (if any), then call applyEdit.
   * Triggered ONLY by the manual "Applica modifica" button — the 5 look
   * chips and the price-tags checkbox no longer auto-fire generations.
   */
  const runManualEdit = () => {
    const textPart = (editPrompt || "").trim();
    const lookPart = selectedLookId
      ? (LOOK_PRESETS.find((lp) => lp.id === selectedLookId)?.prompt || "")
      : "";
    // Compose: text first (the user's specific intent), then the look prompt
    // (which already contains "KEEP the model / outfit unchanged" guards).
    const combined = [textPart, lookPart].filter((p) => p && p.length > 0).join("\n\n");
    applyEdit(combined);
  };

  // Manual-apply button is enabled when ANY of the three sources is set:
  // user typed text, user picked a look, or user ticked "metti i prezzi".
  const canApplyManual = !!(editPrompt.trim() || selectedLookId || addPriceTags);

  const handleGenerateVideo = async (providerId: string) => {
    if (!image) return;
    setVideoBusy(true);
    try {
      const res = await api.createVideo({
        image_base64: image,
        provider: providerId,
        duration_seconds: 5,
        gen_id: id,
        image_index: idx,
      });
      // Optimistically add the new video and refresh from server
      if (res?.video_url) {
        setVideos((prev) => [...prev, res]);
      }
      await loadVideos();
      // Auto-save the freshly archived clip to the device gallery so the
      // shop owner can attach it to a story/post without extra taps.
      const playUrl: string | undefined = res?.playback_url || res?.video_url;
      if (playUrl && res?.archived !== false) {
        try {
          const saved = await saveVideoToGallery(playUrl, `dressvibe_${id}_${idx}_${res.id || Date.now()}`);
          if (saved.ok) {
            const where = saved.where === "gallery" ? "nella galleria del telefono" : "tra i download";
            notify({
              title: "Video pronto ✅",
              message: `Video generato e salvato ${where}. Trovi anche le scorciatoie WhatsApp / Telegram / Instagram qui sotto.`,
            });
          } else {
            notify({ title: "Video pronto", message: "Il tuo video è pronto qui sotto. Premi play per vederlo." });
          }
        } catch {
          notify({ title: "Video pronto", message: "Il tuo video è pronto qui sotto. Premi play per vederlo." });
        }
      } else {
        notify({ title: "Video pronto", message: "Il tuo video è pronto qui sotto. Premi play per vederlo." });
      }
    } catch (e: any) {
      const msg = e?.message || "Errore generazione video";
      if (Platform.OS === "web") notify({ title: "Errore video", message: msg }); else notify({ title: "Errore video", message: msg });
    } finally {
      setVideoBusy(false);
    }
  };

  const handleDeleteVideo = async (videoId: string) => {
    try {
      await api.deleteVideo(videoId);
      setVideos((prev) => prev.filter((v) => v.id !== videoId));
    } catch (e: any) {
      notify({ title: "Errore", message: e?.message || "Impossibile eliminare" });
    }
  };

  const handlePublishVideoTelegram = async (video: any) => {
    if (!(await ensureTelegramConfigured())) return;
    setPublishingTgVideoId(video.id);
    try {
      const captionText =
        tgDescription.trim() ||
        caption?.trim() ||
        "Disponibile in negozio ✨";
      const res = await api.telegramPublish({
        video_url: video.video_url,
        media_type: "video",
        caption: captionText,
        gen_id: id,
        image_index: idx,
      });
      const msg = `Video pubblicato sul canale (id ${res.channel_message_id}).\nQuando un cliente preme "RICHIEDI INFO" riceverai una notifica.`;
      if (Platform.OS === "web") notify({ title: "Pubblicato su Telegram ✅", message: msg }); else notify({ title: "Pubblicato su Telegram", message: msg });
    } catch (e: any) {
      const m = e?.message || "Impossibile pubblicare il video";
      if (Platform.OS === "web") notify({ title: "Errore Telegram", message: m }); else notify({ title: "Errore Telegram", message: m });
    } finally {
      setPublishingTgVideoId(null);
    }
  };

  // ── Per-video state for the new actions on VideoCard ──────────────────────
  // Tracks which video is currently being WhatsApp-shared (so the button can
  // show a busy state without blocking the other clips on the page).
  const [waVideoId, setWaVideoId] = useState<string | null>(null);

  /** Auto-publish to Instagram / Facebook via Zernio. The image is exposed
   * publicly through /zmedia/<gen>/<idx>.jpg so Meta can fetch it. The
   * caption is reused from the "Descrizione Post" textarea above. */
  const [igFbBusy, setIgFbBusy] = useState<null | "instagram" | "facebook">(null);

  const publishToSocial = async (platform: "instagram" | "facebook") => {
    if (igFbBusy) return;
    if (!id) return;
    const caption = (tgDescription || "").trim();
    setIgFbBusy(platform);
    try {
      const r = await api.zernioPublish({
        gen_id: id,
        image_index: idx,
        caption,
        platforms: [platform],
      });
      if (r?.ok) {
        await notify({
          title: `Pubblicato su ${platform === "instagram" ? "Instagram" : "Facebook"} ✅`,
          message: "Il post è in coda di pubblicazione su Meta. Apparirà sul tuo profilo entro 1-2 minuti.",
        });
      }
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.toLowerCase().includes("account non collegato")) {
        await notify({
          title: `${platform === "instagram" ? "Instagram" : "Facebook"} non collegato`,
          message: "Vai in Profilo → Pubblicazione Social e tocca Collega.",
        });
      } else {
        await notify({
          title: "Pubblicazione fallita",
          message: msg || "Riprova fra qualche istante.",
        });
      }
    } finally {
      setIgFbBusy(null);
    }
  };

  /** Save a generated video to the device gallery (or trigger a download on
   * web). Wraps `saveVideoToGallery` so we can surface a friendly toast. */
  const handleSaveVideoToGallery = async (video: any) => {
    const url: string | undefined = video?.playback_url || video?.video_url;
    if (!url) {
      notify({ title: "Video non disponibile", message: "Il file non è più archiviato sul server." });
      return;
    }
    const saved = await saveVideoToGallery(url, `dressvibe_${id}_${idx}_${video.id || Date.now()}`);
    if (saved.ok) {
      const where = saved.where === "gallery" ? "nella galleria del telefono" : "tra i download";
      notify({ title: "Salvato ✅", message: `Video salvato ${where}.` });
    } else {
      notify({
        title: "Salvataggio fallito",
        message: saved.error?.includes("Permesso")
          ? "Concedi a DressVibe il permesso di accedere alle foto nelle impostazioni del telefono."
          : (saved.error || "Riprova fra qualche istante."),
      });
    }
  };

  /** Share a generated video on WhatsApp: save to gallery, copy the message
   * (with the public short-link) to the clipboard, and open the configured
   * channel so the user can paste it as a new post. */
  const shareVideoToWhatsApp = async (video: any) => {
    if (!id || waVideoId === video?.id) return;
    setWaVideoId(video.id);
    try {
      // 1. Verify the channel is configured
      let channelUrl = "";
      try {
        const settings = await api.getUserSettings();
        channelUrl = (settings.whatsapp_channel_url || "").trim();
      } catch {}
      if (!channelUrl) {
        await notify({
          title: "Canale WhatsApp non configurato",
          message: "Vai in Profilo → Canale WhatsApp e incolla il link del tuo canale.",
        });
        return;
      }

      // 2. Save the clip to the gallery (so the user can attach it in WA)
      const url: string | undefined = video?.playback_url || video?.video_url;
      const saved = url
        ? await saveVideoToGallery(url, `dressvibe_${id}_${idx}_${video.id || Date.now()}`)
        : { ok: false, where: "none" as const };

      // 3. Generate (or reuse) a public short link for this look + image
      const link = await api.createShortLink({
        gen_id: id,
        image_index: idx,
        look_name: genTitle || "Look DressVibe",
      });

      const shareUrl = link.public_url;
      const desc = (tgDescription || "").trim();
      const clipboardText = (desc ? `${desc}\n\n` : "") +
        `👇 Premi qui per ricevere info 👇\n${shareUrl}`;
      try { await Clipboard.setStringAsync(clipboardText); } catch {}

      // 4. Open WhatsApp channel
      let opened = false;
      if (Platform.OS === "web") {
        try {
          if (typeof document !== "undefined") {
            const a = document.createElement("a");
            a.href = channelUrl;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { try { a.remove(); } catch {} }, 1000);
            opened = true;
          }
        } catch {}
      } else {
        try { await Linking.openURL(channelUrl); opened = true; }
        catch {
          try {
            await Linking.openURL(channelUrl.replace("whatsapp.com/channel/", "wa.me/channel/"));
            opened = true;
          } catch {}
        }
      }

      const savedMsg = saved.ok
        ? (saved.where === "gallery" ? "🎬 Video salvato nella galleria.\n" : "📥 Video scaricato.\n")
        : "";

      if (opened) {
        await notify({
          title: "Pronto per WhatsApp ✅",
          message: savedMsg +
            (desc ? `Testo:\n${desc}\n\n` : "") +
            `Link copiato:\n${shareUrl}\n\n` +
            "Nel canale: nuovo post → allega il video dalla galleria → incolla il testo.",
        });
      } else {
        await notify({
          title: "Apri WhatsApp manualmente",
          message: savedMsg +
            `Canale: ${channelUrl}\n\nTesto copiato:\n` +
            (desc ? `${desc}\n\n` : "") +
            `👇 Premi qui per ricevere info 👇\n${shareUrl}`,
        });
      }
    } catch (e: any) {
      notify({ title: "Errore", message: e?.message || "Impossibile condividere il video" });
    } finally {
      setWaVideoId(null);
    }
  };

  const resetImage = () => { if (originalImage) setImage(originalImage); };

  const generateCaption = async () => {
    setCapBusy(true);
    try {
      const r = await api.caption({
        garment_name: genTitle || "Capo moda",
        category: "outfit",
        style: "instagram",
      });
      setCaption(r.caption);
    } catch (e: any) {
      notify({ title: "Errore", message: e?.message || "Errore caption" });
    } finally {
      setCapBusy(false);
    }
  };

  const copyCaption = async () => {
    if (!caption) return;
    await Clipboard.setStringAsync(caption);
    notify({ title: "Copiato!", message: "La caption è negli appunti." });
  };

  /** Pre-flight check shared by every Telegram action.
   *
   * We hit GET /api/settings first so the user gets an instant, friendly
   * notify ("Canale Telegram non inserito") instead of having to wait for
   * the full publish payload (with the heavy base64 image) to be uploaded
   * and rejected with a 400 by the backend. Returns true when ready.
   */
  const ensureTelegramConfigured = async (): Promise<boolean> => {
    try {
      const s = await api.getUserSettings();
      const ch = (s?.telegram_channel || "").trim();
      if (!ch) {
        notify({
          title: "⚠️ Canale Telegram non inserito",
          message: "Vai su Profilo → Impostazioni e inserisci il tuo canale Telegram prima di pubblicare.",
        });
        return false;
      }
      return true;
    } catch {
      return true;
    }
  };

  const downloadAndShare = async (target: "telegram" | "instagram" | "share") => {
    if (!image) {
      if (Platform.OS === "web" && typeof window !== "undefined") { notify({ title: "Nessuna immagine selezionata" }); }
      else { notify({ title: "Nessuna immagine selezionata" }); }
      return;
    }

    // Publish to the configured Telegram channel with a booking button
    if (target === "telegram") {
      // Pre-flight: refuse early with a friendly notify if the user
      // forgot to configure their channel.
      if (!(await ensureTelegramConfigured())) return;
      try {
        setBusy(true);
        const captionText =
          tgDescription.trim() ||
          caption?.trim() ||
          "Disponibile in negozio ✨";
        const res = await api.telegramPublish({
          image_base64: image,
          media_type: "photo",
          caption: captionText,
          gen_id: id,
          image_index: idx,
        });
        const msg = `Foto pubblicata sul canale (id ${res.channel_message_id}).\n\nQuando un cliente preme "RICHIEDI INFO" riceverai una notifica.`;
        if (Platform.OS === "web" && typeof window !== "undefined") {
          notify({ title: "Pubblicato su Telegram ✅", message: msg });
        } else {
          notify({ title: "Pubblicato su Telegram", message: msg });
        }
      } catch (e: any) {
        const errMsg = e?.message || "Impossibile pubblicare";
        if (Platform.OS === "web" && typeof window !== "undefined") {
          notify({ title: "Errore Telegram", message: errMsg });
        } else {
          notify({ title: "Errore Telegram", message: errMsg });
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      const opts = {
        imageBase64: image,
        caption: caption?.trim() || undefined,
        fileBaseName: `dressvibe_${id}_${idx}`,
      };
      if (target === "instagram") {
        // Instagram app handover only works reliably on native (iOS/Android)
        // — on web the browser can't pop the Instagram app, and on the
        // Emergent preview iframe the system share sheet is also blocked.
        // Give the user a clear "what to do" message instead of failing
        // silently.
        if (Platform.OS === "web") {
          notify({
            title: "⚠️ Instagram disponibile solo su cellulare",
            message:
              "Apri DressVibe dal telefono per pubblicare direttamente su Instagram. Da qui puoi solo scaricare la foto col pulsante 'Scarica' e poi caricarla manualmente.",
          });
          return;
        }
        await shareToInstagram(opts);
      } else {
        await shareGeneric(opts);
      }
    } catch (e: any) {
      notify({ title: "Errore", message: e?.message || "Impossibile condividere" });
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} testID="studio-back">
            <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Studio</Text>
          <TouchableOpacity onPress={resetImage} testID="studio-reset">
            <Ionicons name="refresh-outline" size={20} color={theme.colors.text} />
          </TouchableOpacity>
        </View>

        {edited ? (
          <View style={s.editedBanner} testID="studio-edited-banner">
            <Ionicons name="checkmark-circle" size={14} color={theme.colors.success} />
            <Text style={s.editedText}>
              Modifica salvata nella galleria di questa generazione
            </Text>
          </View>
        ) : null}

        <ScrollView contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
          <View style={s.imageWrap}>
            {loading || !image ? (
              <View style={s.imagePh}><ActivityIndicator color={theme.colors.text} /></View>
            ) : (
              <Image source={{ uri: `data:image/png;base64,${image}` }} style={s.image} />
            )}
            {busy && (
              <View style={s.busyOverlay}>
                <ActivityIndicator color="#fff" />
                <Text style={s.busyText}>Applicazione modifica…</Text>
              </View>
            )}
          </View>

          {/* Quick edits */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Modifiche rapide</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
              {QUICK_EDITS.map((q) => (
                <TouchableOpacity
                  key={q.label}
                  onPress={() => applyEdit(q.prompt)}
                  disabled={busy}
                  style={s.quickChip}
                  testID={`quick-${q.label}`}
                >
                  <Text style={s.quickText}>{q.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* "Inserisci prezzi nell'immagine" toggle — when ON, every
              edit/look call (quick-edits, custom edit, Cambia look)
              passes add_price_tags=true to the backend so Gemini
              overlays price tags using the descriptions provided in the
              garment "Descrizione e prezzi" field. */}
          <View style={s.section}>
            <TouchableOpacity
              onPress={() => setAddPriceTags((v) => !v)}
              activeOpacity={0.8}
              style={s.priceToggleRow}
              testID="studio-toggle-prices"
            >
              <View style={[s.checkbox, addPriceTags && s.checkboxOn]}>
                {addPriceTags ? <Text style={s.checkboxMark}>✓</Text> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.priceToggleLabel}>Inserisci prezzi nell'immagine</Text>
                <Text style={s.priceToggleHint}>
                  Aggiunge cartellini con i prezzi (presi dalla descrizione del capo) accanto ai capi corrispondenti, durante le modifiche.
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Custom edit */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Modifica personalizzata</Text>
            <TextInput
              value={editPrompt} onChangeText={setEditPrompt}
              placeholder="es. Aggiungi il prezzo €49 in alto a sinistra"
              placeholderTextColor={theme.colors.textMuted}
              style={s.input}
              testID="studio-prompt"
              multiline
            />

            {/* Genera Video — collocato fra la modifica personalizzata
                e il bottone "Applica modifica" su richiesta dell'utente. */}
            <View style={{ marginTop: 8, gap: 8 }}>
              <Text style={s.sectionLabel}>🎬 Genera Video</Text>
              <Text style={s.videoHint}>
                Crea una clip 9:16 da questa foto: la modella gira su se stessa, cammina, mostra l'outfit. ~60–120 secondi di attesa.
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
                {videoProviders.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => handleGenerateVideo(p.id)}
                    disabled={!p.enabled || videoBusy}
                    style={[s.videoBtn, (!p.enabled || videoBusy) && { opacity: 0.45 }]}
                    testID={`video-${p.id}`}
                  >
                    <Text style={s.videoBtnName}>{p.name}</Text>
                    <Text style={s.videoBtnSub}>
                      {p.enabled ? "✨ Pronto" : `🔒 ${p.missing_keys?.join(", ")}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {videoBusy ? (
                <View style={s.videoBusy} testID="video-busy">
                  <ActivityIndicator color={theme.colors.text} />
                  <Text style={s.videoBusyText}>Sto generando il video… può richiedere 1–3 minuti</Text>
                </View>
              ) : null}

              {videos.length > 0 ? (
                <View style={{ gap: 18, marginTop: 4 }} testID="video-list">
                  <Text style={s.videoListLabel}>I tuoi video ({videos.length})</Text>
                  {videos.map((v) => (
                    <VideoCard
                      key={v.id}
                      url={v.playback_url || v.video_url}
                      expired={!v.archived}
                      width={300}
                      height={Math.round(300 * (16 / 9))}
                      onDelete={() => handleDeleteVideo(v.id)}
                      onPublishTelegram={() => handlePublishVideoTelegram(v)}
                      publishingTelegram={publishingTgVideoId === v.id}
                      onShareWhatsApp={() => shareVideoToWhatsApp(v)}
                      publishingWhatsApp={waVideoId === v.id}
                      onShareInstagram={() => setIgSheet({ video: v.playback_url || v.video_url })}
                      onSaveToGallery={() => handleSaveVideoToGallery(v)}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          </View>

          {/* Cambia look — 5 preset estetici che ri-renderizzano la foto
              mantenendo modello e outfit. Tap = SELEZIONE only (no auto-run).
              The actual edit fires when the user presses "Applica modifica"
              at the bottom of the section. */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>✨ Cambia look</Text>
            <Text style={s.lookHint}>
              Cinque stili pronti per ri-renderizzare la foto. Modello e outfit restano identici — cambia solo l'estetica. Selezionane uno e poi premi "Applica modifica" in fondo.
            </Text>
            <View style={s.lookGrid}>
              {LOOK_PRESETS.map((lp) => {
                const active = selectedLookId === lp.id;
                return (
                  <TouchableOpacity
                    key={lp.id}
                    onPress={() => {
                      setSelectedLookId((curr) => (curr === lp.id ? null : lp.id));
                    }}
                    disabled={busy}
                    style={[s.lookBtn, active && s.lookBtnActive, busy && { opacity: 0.45 }]}
                    activeOpacity={0.85}
                    testID={`studio-look-${lp.id}`}
                  >
                    <Text style={s.lookEmoji}>{lp.emoji}</Text>
                    <Text style={[s.lookLabel, active && s.lookLabelActive]}>{lp.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Manual "Applica modifica" button — fires only on press, and
                combines: free text + selected look preset + add_price_tags. */}
            <TouchableOpacity
              onPress={runManualEdit}
              disabled={!canApplyManual || busy}
              activeOpacity={0.85}
              testID="studio-apply"
              style={{ marginTop: 12 }}
            >
              <LinearGradient
                colors={MAGIC_GRADIENT}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={[s.applyBtn, (!canApplyManual || busy) && { opacity: 0.45 }]}
              >
                <Ionicons name="sparkles" size={16} color="#fff" />
                <Text style={s.applyText}>Applica modifica</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Descrizione Post — usata sia per Telegram che per WhatsApp */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>📝 Descrizione Post</Text>
            <Text style={s.tgHint}>
              Questo testo apparirà sotto la foto/video pubblicata su Telegram e sopra il link "Premi qui per ricevere info" quando posti su WhatsApp.
            </Text>
            <TextInput
              value={tgDescription}
              onChangeText={setTgDescription}
              multiline
              placeholder="es. Nuovo arrivo — Maglione Cashmere · €189 · Tg S/M/L · Disponibile in negozio o spedizione gratuita"
              placeholderTextColor={theme.colors.textMuted}
              style={[s.input, { minHeight: 90, textAlignVertical: "top" }]}
              testID="tg-description-input"
              maxLength={1000}
            />
            <Text style={s.tgCounter}>{tgDescription.length}/1000</Text>
          </View>

          {/* Auto-publish (Instagram + Facebook via Zernio) */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>📤 Pubblica automaticamente</Text>
            <Text style={s.tgHint}>
              Pubblica direttamente sui tuoi profili social. La descrizione del post qui sopra viene usata come caption.
            </Text>
            <View style={[s.shareRow, { gap: 10 }]}>
              <TouchableOpacity
                style={[s.autoPubBtn, { borderColor: "#dd2a7b" }, igFbBusy === "instagram" && { opacity: 0.5 }]}
                onPress={() => publishToSocial("instagram")}
                disabled={igFbBusy !== null}
                testID="zernio-publish-ig"
                activeOpacity={0.85}
              >
                {igFbBusy === "instagram" ? (
                  <ActivityIndicator color="#dd2a7b" />
                ) : (
                  <>
                    <Ionicons name="logo-instagram" size={18} color="#dd2a7b" />
                    <Text style={[s.autoPubText, { color: "#dd2a7b" }]}>Instagram</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.autoPubBtn, { borderColor: "#1877F2" }, igFbBusy === "facebook" && { opacity: 0.5 }]}
                onPress={() => publishToSocial("facebook")}
                disabled={igFbBusy !== null}
                testID="zernio-publish-fb"
                activeOpacity={0.85}
              >
                {igFbBusy === "facebook" ? (
                  <ActivityIndicator color="#1877F2" />
                ) : (
                  <>
                    <Ionicons name="logo-facebook" size={18} color="#1877F2" />
                    <Text style={[s.autoPubText, { color: "#1877F2" }]}>Facebook</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Share */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Condividi</Text>
            <View style={s.shareRow}>
              <TouchableOpacity
                style={[s.shareWordBtn, busy && { opacity: 0.6 }]}
                onPress={() => downloadAndShare("telegram")}
                testID="share-telegram"
                disabled={busy}
                activeOpacity={0.7}
              >
                {busy ? (
                  <ActivityIndicator color="#229ED9" />
                ) : (
                  <Text style={[s.shareWord, { color: "#229ED9" }]}>Telegram</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={s.shareWordBtn}
                onPress={openInstagramShare}
                testID="share-instagram"
                activeOpacity={0.7}
              >
                <Text style={[s.shareWord, { color: "#E4405F" }]}>Instagram</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.shareWordBtn, waBusy && { opacity: 0.6 }]}
                onPress={shareToWhatsApp}
                disabled={waBusy}
                testID="share-whatsapp"
                activeOpacity={0.7}
              >
                {waBusy ? (
                  <ActivityIndicator color="#25D366" />
                ) : (
                  <Text style={[s.shareWord, { color: "#25D366" }]}>WhatsApp</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={s.shareWordBtn}
                onPress={async () => {
                  if (!image) {
                    notify({ title: "Nessuna immagine selezionata" });
                    return;
                  }
                  const saved = await saveImageToGallery(image, `dressvibe_${id}_${idx}`);
                  if (saved.ok) {
                    if (Platform.OS === "web") {
                      notify({ title: "Foto scaricata 📥", message: "L'immagine è stata scaricata dal browser. Se sei su iPhone Safari, l'anteprima si apre in una nuova scheda — tienila premuta e tocca \"Salva in Foto\"." });
                    } else if (saved.where === "gallery") {
                      notify({ title: "Foto salvata 📸", message: "L'immagine è ora nella tua galleria, dentro l'album \"DressVibe\"." });
                    } else {
                      notify({ title: "Foto scaricata 📥", message: "Foto salvata sul dispositivo." });
                    }
                  } else {
                    notify({ title: "Salvataggio non riuscito", message: saved.error?.includes("Permesso") ? "Per salvare le foto nella galleria devi concedere il permesso a DressVibe nelle impostazioni del telefono." : (saved.error || "Riprova") });
                  }
                }}
                testID="share-download"
                activeOpacity={0.7}
              >
                <Text style={[s.shareWord, { color: theme.colors.text }]}>Scarica</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <InstagramShareSheet
        visible={!!igSheet}
        onClose={() => setIgSheet(null)}
        imageBase64={igSheet?.image}
        videoUrl={igSheet?.video}
        genId={id}
        imageIndex={idx}
        skipSave={igSheet?.skipSave}
      />
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
  headerTitle: { color: theme.colors.text, fontSize: 14, letterSpacing: 2, textTransform: "uppercase" },
  imageWrap: {
    marginTop: 16, aspectRatio: 9 / 16, backgroundColor: theme.colors.surface, position: "relative",
    alignSelf: "center", width: "100%", maxWidth: 380,
  },
  imagePh: { flex: 1, alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center", gap: 10,
  },
  busyText: { color: "#fff", fontSize: 12, letterSpacing: 1 },
  section: { paddingHorizontal: 24, marginTop: 24, gap: 10 },
  sectionLabel: { color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 2, textTransform: "uppercase" },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  captionGen: { color: theme.colors.text, fontSize: 12, fontWeight: "500" },
  quickChip: {
    paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
  },
  quickText: { color: theme.colors.text, fontSize: 12 },
  input: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    color: theme.colors.text, padding: 14, fontSize: 14, minHeight: 60,
  },
  applyBtn: {
    paddingVertical: 14, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10,
  },
  applyText: { color: "#fff", fontWeight: "700", letterSpacing: 0.4 },
  copyBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.colors.border,
  },
  copyText: { color: theme.colors.text, fontSize: 12 },
  shareRow: { flexDirection: "row", gap: 10, justifyContent: "center" },
  autoPubBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderWidth: 1.5,
    backgroundColor: theme.colors.surface,
    minHeight: 48,
  },
  autoPubText: { fontSize: 13, fontWeight: "700", letterSpacing: 0.4 },
  shareIconBtn: {
    width: 64, height: 64,
    alignItems: "center", justifyContent: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
  },
  shareEmoji: { fontSize: 30, lineHeight: 36, textAlign: "center" },
  shareWordBtn: {
    flex: 1,
    paddingVertical: 16, paddingHorizontal: 6,
    alignItems: "center", justifyContent: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    borderWidth: 1, borderColor: theme.colors.border,
    minHeight: 52,
  },
  shareWord: { fontSize: 13, fontWeight: "700", letterSpacing: 0.2, textAlign: "center" },
  shareBtn: {
    flex: 1, alignItems: "center", paddingVertical: 18, gap: 6,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
  },
  shareLabel: { color: theme.colors.text, fontSize: 11, letterSpacing: 0.6, textAlign: "center" },
  shareSub: { color: theme.colors.textMuted, fontSize: 9, textAlign: "center" },
  videoHint: { color: theme.colors.textSecondary, fontSize: 11, lineHeight: 16, marginBottom: 4 },
  videoBtn: {
    paddingVertical: 14, paddingHorizontal: 18, borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, minWidth: 160, gap: 4,
  },
  videoBtnName: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  videoBtnSub: { color: theme.colors.textSecondary, fontSize: 10 },
  videoBusy: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 14, borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  videoBusyText: { color: theme.colors.textSecondary, fontSize: 12, flex: 1 },
  videoListLabel: {
    color: theme.colors.text, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase",
  },
  editedBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 24, marginTop: 12, padding: 10,
    borderWidth: 1, borderColor: theme.colors.success,
    backgroundColor: "rgba(16,185,129,0.08)",
  },
  editedText: { color: theme.colors.success, fontSize: 12, flex: 1 },
  // Cambia look (Studio)
  lookHint: {
    color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: -2,
  },
  lookGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4,
  },
  lookBtn: {
    flexBasis: "31%", flexGrow: 1,
    paddingVertical: 14, paddingHorizontal: 8,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: "center", justifyContent: "center", gap: 4,
    minWidth: 90,
  },
  lookBtnActive: {
    borderColor: theme.colors.primary,
    backgroundColor: "rgba(225,29,72,0.12)", // soft brand-red tint
    borderWidth: 2,
  },
  lookEmoji: { fontSize: 22 },
  lookLabel: {
    color: theme.colors.text, fontSize: 12, fontWeight: "600", letterSpacing: 0.3,
  },
  lookLabelActive: {
    color: theme.colors.primary,
    fontWeight: "700",
  },
  // Price-tags toggle
  priceToggleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  checkbox: {
    width: 22, height: 22,
    borderWidth: 1.5,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.bg,
    alignItems: "center", justifyContent: "center",
    marginTop: 2,
  },
  checkboxOn: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  checkboxMark: {
    color: theme.colors.primaryFg,
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 16,
  },
  priceToggleLabel: {
    color: theme.colors.text, fontSize: 14, fontWeight: "600",
  },
  priceToggleHint: {
    color: theme.colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 3,
  },
});

