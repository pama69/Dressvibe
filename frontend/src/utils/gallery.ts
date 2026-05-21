/**
 * Salva un'immagine base64 nella galleria del dispositivo (Foto su iOS,
 * Galleria su Android). Su web fa un download via tag <a>.
 *
 * Restituisce true se il salvataggio è andato a buon fine. Nessun alert
 * viene mostrato — il chiamante decide cosa mostrare. Errori non-fatali
 * (permesso negato, web download) vengono silenziati ma loggati.
 */
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";

export type SaveResult = {
  ok: boolean;
  /** dove è stato salvato — "gallery" su nativo, "download" su web, "none" su errore */
  where: "gallery" | "download" | "none";
  error?: string;
};

export async function saveImageToGallery(
  imageBase64: string,
  fileBaseName: string = "dressvibe"
): Promise<SaveResult> {
  if (!imageBase64) return { ok: false, where: "none", error: "Immagine vuota" };

  // ---------- WEB ----------
  if (Platform.OS === "web") {
    try {
      const filename = `${fileBaseName}.png`;
      // Convert base64 → Blob → ObjectURL. iOS Safari + Emergent preview
      // iframe both refuse to honor `download` on `data:` URLs, but a real
      // blob URL is treated as a same-origin resource and the download
      // attribute works (or, as a graceful fallback, the browser opens the
      // image in a new tab and the user can long-press → "Save to Photos").
      const byteString = atob(imageBase64);
      const bytes = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
      const blob = new Blob([bytes], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.target = "_blank"; // iOS Safari fallback: opens preview so user can save
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      // Cleanup later to give the browser time to start the download.
      setTimeout(() => {
        try { a.remove(); URL.revokeObjectURL(url); } catch {}
      }, 4000);
      return { ok: true, where: "download" };
    } catch (e: any) {
      return { ok: false, where: "none", error: e?.message };
    }
  }

  // ---------- NATIVE (iOS / Android) ----------
  try {
    // Chiediamo i permessi (writeOnly=true se possibile, altrimenti full)
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (perm.status !== "granted") {
      return { ok: false, where: "none", error: "Permesso galleria negato" };
    }

    const path = `${FileSystem.cacheDirectory}${fileBaseName}_${Date.now()}.png`;
    await FileSystem.writeAsStringAsync(path, imageBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const asset = await MediaLibrary.createAssetAsync(path);
    try {
      const album = await MediaLibrary.getAlbumAsync("DressVibe");
      if (album) {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      } else {
        await MediaLibrary.createAlbumAsync("DressVibe", asset, false);
      }
    } catch (e) {
      // Album creation può fallire su alcune versioni di Android — l'asset è già salvato
      console.warn("album save failed", e);
    }
    return { ok: true, where: "gallery" };
  } catch (e: any) {
    return { ok: false, where: "none", error: e?.message || "Errore di salvataggio" };
  }
}
