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
import Constants from "expo-constants";
import { storage } from "@/src/utils/storage";
import { api } from "@/src/api/client";

const PREF_KEY = "push_notifications_enabled";
const TOKEN_KEY = "push_remote_token";

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

// ----------------------------------------------------------------------------
// Push REMOTI (consegna anche ad app completamente chiusa).
//
// Richiedono un token Expo, che a sua volta richiede:
//   • un device fisico (non funziona su simulatore né su web);
//   • una build EAS di sviluppo o produzione (Expo Go non supporta più i push
//     remoti da SDK 53) con un projectId EAS in app.json (extra.eas.projectId)
//     e le credenziali push configurate (FCM per Android, APNs per iOS).
// Il token viene poi salvato sul backend, che invia il push all'arrivo di una
// nuova richiesta info.
// ----------------------------------------------------------------------------

/** Ottiene l'Expo push token per questo device. Null se non disponibile. */
export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  const N = await getNative();
  if (!N) return null;
  try {
    const granted = await requestPushPermission();
    if (!granted) return null;
    const projectId =
      (Constants as any)?.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId ??
      undefined;
    const resp = await N.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return resp?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Registra il device sul backend per i push remoti.
 * Ritorna true se il token è stato ottenuto e salvato.
 */
export async function enableRemotePush(): Promise<boolean> {
  const token = await getExpoPushToken();
  if (!token) return false;
  try {
    await api.pushRegister(token, Platform.OS);
    await storage.setItem(TOKEN_KEY, token);
    return true;
  } catch {
    return false;
  }
}

/** Rimuove la registrazione remota dal backend (best-effort). */
export async function disableRemotePush(): Promise<void> {
  try {
    const token = await storage.getItem<string>(TOKEN_KEY, "");
    if (token) await api.pushUnregister(token);
  } catch {}
  await storage.removeItem(TOKEN_KEY);
}
