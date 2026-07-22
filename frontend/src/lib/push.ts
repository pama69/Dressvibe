/**
 * Notifiche push "on-device" (locali).
 *
 * Quando la campanella in-app si accende (arriva una nuova richiesta info dai
 * clienti), oltre al badge + "ding" facciamo comparire una vera notifica di
 * sistema sul dispositivo — così il negoziante la vede anche con l'app in
 * background o lo schermo su un'altra schermata.
 *
 * È un flusso *locale*: la notifica viene presentata dall'app stessa mentre è
 * in esecuzione (il polling di NotificationsContext gira ogni ~60s). Non serve
 * un server push Expo/FCM/APNs — il che la rende immediata da attivare senza
 * credenziali extra. Con l'app completamente chiusa non arriverà nulla: per
 * quello servirebbero i push remoti (token Expo + invio dal backend).
 *
 * Web: usa la Web Notifications API del browser. Nativo (iOS/Android): usa
 * `expo-notifications`, importato pigramente così che il bundle web non lo
 * richieda.
 */
import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";

const PREF_KEY = "push_notifications_enabled";

// Cache del modulo nativo (import dinamico: assente su web).
let _N: any | undefined;
let _handlerSet = false;

async function getNative(): Promise<any | null> {
  if (Platform.OS === "web") return null;
  if (_N === undefined) {
    _N = await import("expo-notifications").catch(() => null);
  }
  if (_N && !_handlerSet) {
    _handlerSet = true;
    try {
      _N.setNotificationHandler({
        handleNotification: async () => ({
          // Campi SDK 54 (shouldShowAlert è deprecato → banner + list).
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
    } catch {}
  }
  return _N;
}

/** Preferenza persistita: l'utente ha abilitato le notifiche push? */
export async function isPushEnabled(): Promise<boolean> {
  return (await storage.getItem<boolean>(PREF_KEY, false)) === true;
}

/** Salva la preferenza (senza richiedere permessi: quello lo fa il chiamante). */
export async function setPushPref(enabled: boolean): Promise<void> {
  await storage.setItem(PREF_KEY, enabled);
}

/**
 * Chiede all'utente il permesso di mostrare notifiche.
 * Ritorna true se concesso. Su Android configura anche il canale di default.
 */
export async function requestPushPermission(): Promise<boolean> {
  if (Platform.OS === "web") {
    try {
      const N: any = (globalThis as any).Notification;
      if (!N) return false;
      if (N.permission === "granted") return true;
      if (N.permission === "denied") return false;
      const res = await N.requestPermission();
      return res === "granted";
    } catch {
      return false;
    }
  }

  const N = await getNative();
  if (!N) return false;
  try {
    const current = await N.getPermissionsAsync();
    let granted = current.granted || current.status === "granted";
    if (!granted && current.canAskAgain !== false) {
      const req = await N.requestPermissionsAsync();
      granted = req.granted || req.status === "granted";
    }
    if (Platform.OS === "android") {
      // Un canale è obbligatorio su Android 8+ perché la notifica compaia.
      await N.setNotificationChannelAsync("default", {
        name: "Notifiche DressVibe",
        importance: N.AndroidImportance?.HIGH ?? 4,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#7c3aed",
      });
    }
    return granted;
  } catch {
    return false;
  }
}

/**
 * Presenta subito una notifica locale sul dispositivo.
 * Silenziosa in caso di errore o permessi mancanti.
 */
export async function presentLocalNotification(title: string, body: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      const N: any = (globalThis as any).Notification;
      if (N && N.permission === "granted") {
        // eslint-disable-next-line no-new
        new N(title, { body });
      }
    } catch {}
    return;
  }

  const N = await getNative();
  if (!N) return;
  try {
    await N.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: null, // null = mostra immediatamente
    });
  } catch {}
}
