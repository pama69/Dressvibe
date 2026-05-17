/**
 * DressVibe share utilities.
 *
 * Today we use the OS native share sheet (expo-sharing) on mobile, and the
 * browser download + clipboard combo on web. This keeps the UX consistent for
 * the shop owner: tap "Instagram" → the system opens Instagram in the share
 * list, the caption is already in the clipboard, ready to paste.
 *
 * Future-proof: when the user connects an Instagram Business / Creator account
 * (linked to a Facebook page), we will plug in the Graph API in
 * `publishToInstagramGraph()` below and the UI does NOT have to change. The
 * Studio screen just calls `shareToInstagram()` which dispatches to either
 * native share (default) or Graph API (when configured).
 *
 * Plug-in points:
 *   - Add a server-side endpoint /api/instagram/publish that takes
 *     image_base64 + caption and calls the Graph API.
 *   - Set `INSTAGRAM_GRAPH_ENABLED` to true here OR check via /api/providers.
 *   - Implement `publishToInstagramGraph()` to call that endpoint.
 */

import { Platform, Share, Alert } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

export const INSTAGRAM_GRAPH_ENABLED = false;

export type ShareTarget = "instagram" | "share";

export type ShareOptions = {
  imageBase64: string;
  caption?: string;
  fileBaseName?: string;
};

function alertWeb(title: string, msg?: string) {
  if (typeof window !== "undefined") {
    window.alert(msg ? `${title}\n\n${msg}` : title);
  }
}

async function downloadOnWeb(opts: ShareOptions) {
  const name = (opts.fileBaseName || "dressvibe") + ".png";
  const link = document.createElement("a");
  link.href = `data:image/png;base64,${opts.imageBase64}`;
  link.download = name;
  link.click();
  if (opts.caption) await Clipboard.setStringAsync(opts.caption);
}

async function shareOnNative(opts: ShareOptions, dialogTitle: string) {
  const name = (opts.fileBaseName || "dressvibe") + ".png";
  const path = `${FileSystem.cacheDirectory}${name}`;
  await FileSystem.writeAsStringAsync(path, opts.imageBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (opts.caption) await Clipboard.setStringAsync(opts.caption);

  const ok = await Sharing.isAvailableAsync();
  if (ok) {
    await Sharing.shareAsync(path, { dialogTitle });
  } else {
    await Share.share({ url: path, message: opts.caption || "Da DressVibe" });
  }
}

/**
 * Future hook for Instagram Graph API (Business/Creator accounts only).
 * Currently a stub. Once user provides a long-lived access token and IG
 * Business Account ID, implement this to call /api/instagram/publish.
 */
async function publishToInstagramGraph(_opts: ShareOptions): Promise<void> {
  throw new Error("Instagram Graph API non ancora configurata.");
}

/**
 * Share an image to Instagram. Uses the OS native share sheet today;
 * automatically uses Graph API when enabled in the future.
 */
export async function shareToInstagram(opts: ShareOptions): Promise<void> {
  if (INSTAGRAM_GRAPH_ENABLED) {
    return publishToInstagramGraph(opts);
  }
  if (Platform.OS === "web") {
    await downloadOnWeb(opts);
    alertWeb(
      "Pronto per Instagram",
      "Immagine scaricata e caption copiata. Aprila in Instagram dal telefono per pubblicarla.",
    );
    return;
  }
  await shareOnNative(opts, "Pubblica su Instagram");
  if (opts.caption) {
    Alert.alert("Caption copiata", "La caption è negli appunti, incollala su Instagram.");
  }
}

/** Generic share / download. */
export async function shareGeneric(opts: ShareOptions): Promise<void> {
  if (Platform.OS === "web") {
    await downloadOnWeb(opts);
    alertWeb("Immagine scaricata", opts.caption ? "Caption copiata negli appunti." : undefined);
    return;
  }
  await shareOnNative(opts, "Condividi outfit DressVibe");
}
