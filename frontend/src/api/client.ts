import { storage } from "@/src/utils/storage";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const TOKEN_KEY = "dv_session_token";

export async function getToken(): Promise<string | null> {
  return await storage.secureGet<string>(TOKEN_KEY, "");
}

export async function setToken(token: string): Promise<void> {
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await storage.secureRemove(TOKEN_KEY);
}

async function request<T>(
  path: string,
  options: { method?: string; body?: any; auth?: boolean; timeoutMs?: number } = {}
): Promise<T> {
  const { method = "GET", body, auth = true, timeoutMs = 30000 } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (auth) {
    const token = await getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === "AbortError") {
      const err: any = new Error(
        "Richiesta troppo lenta — il server sta impiegando troppo tempo. Riprova tra qualche secondo."
      );
      err.code = "TIMEOUT";
      throw err;
    }
    throw e;
  }
  clearTimeout(timer);
  if (!res.ok) {
    const txt = await res.text();
    let detail = txt;
    try {
      detail = JSON.parse(txt).detail || txt;
    } catch {}
    const err: any = new Error(detail || `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const api = {
  // auth
  exchangeSession: (session_id: string) =>
    request<{ session_token: string; user: any }>("/auth/session", {
      method: "POST",
      body: { session_id },
      auth: false,
    }),
  me: () => request<any>("/auth/me"),
  logout: () => request<any>("/auth/logout", { method: "POST" }),

  // garments
  listGarments: () => request<any[]>("/garments"),
  createGarment: (g: any) =>
    request<any>("/garments", { method: "POST", body: g }),
  deleteGarment: (id: string) =>
    request<any>(`/garments/${id}`, { method: "DELETE" }),

  // generations
  createGeneration: (g: any) =>
    request<any>("/generations", { method: "POST", body: g, timeoutMs: 90000 }),
  listGenerations: () => request<any[]>("/generations"),
  getGeneration: (id: string) => request<any>(`/generations/${id}`),
  deleteGeneration: (id: string) =>
    request<any>(`/generations/${id}`, { method: "DELETE" }),
  deleteGenerationImage: (id: string, index: number) =>
    request<any>(`/generations/${id}/images/${index}`, { method: "DELETE" }),

  // studio
  studioEdit: (image_base64: string, edit_prompt: string, gen_id?: string) =>
    request<{ image_base64: string }>("/studio/edit", {
      method: "POST",
      body: { image_base64, edit_prompt, gen_id },
      timeoutMs: 90000,
    }),

  // clients
  listClients: () => request<any[]>("/clients"),
  createClient: (c: any) =>
    request<any>("/clients", { method: "POST", body: c }),
  deleteClient: (id: string) =>
    request<any>(`/clients/${id}`, { method: "DELETE" }),

  // custom backgrounds
  listBackgrounds: () => request<any[]>("/backgrounds"),
  createBackground: (b: { name: string; image_base64: string; description?: string }) =>
    request<any>("/backgrounds", { method: "POST", body: b }),
  deleteBackground: (id: string) =>
    request<any>(`/backgrounds/${id}`, { method: "DELETE" }),

  // instagram caption
  generateInstagramCaption: (body: {
    gen_id?: string;
    image_index?: number;
    media_type: "photo" | "video";
    style?: "elegante" | "friendly" | "minimal" | "trendy";
    shop_name?: string;
    city?: string;
    extra_hint?: string;
  }) =>
    request<{ caption: string; hashtags: string[]; hook: string; style: string; fallback?: boolean }>(
      "/instagram/caption",
      { method: "POST", body }
    ),

  // providers
  listProviders: () =>
    request<Record<string, Array<{
      id: string; name: string; description: string; enabled: boolean;
      badge: string | null; missing_keys?: string[];
    }>>>("/providers"),

  // videos
  createVideo: (body: {
    image_base64: string; prompt?: string; duration_seconds?: number;
    provider?: string; gen_id?: string; image_index?: number;
  }) => request<any>("/videos", { method: "POST", body, timeoutMs: 180000 }),
  listVideos: () => request<any[]>("/videos"),
  listGenerationVideos: (genId: string) =>
    request<any[]>(`/generations/${genId}/videos`),
  deleteVideo: (videoId: string) =>
    request<any>(`/videos/${videoId}`, { method: "DELETE" }),

  // caption
  caption: (body: any) =>
    request<{ caption: string }>("/caption", { method: "POST", body }),

  // telegram
  telegramPublish: (body: {
    image_base64?: string;
    video_url?: string;
    media_type?: "photo" | "video";
    caption?: string;
    gen_id?: string;
    image_index?: number;
  }) =>
    request<{ ok: boolean; channel_message_id: number; token: string; media_type: string }>(
      "/telegram/publish",
      { method: "POST", body }
    ),
  telegramSetupWebhook: () =>
    request<{ ok: boolean; webhook_url: string; info: any }>(
      "/telegram/setup-webhook",
      { method: "POST", body: {} }
    ),
  telegramWebhookInfo: () =>
    request<{ ok: boolean; info: any }>("/telegram/webhook-info"),

  // user settings (per-shop preferences)
  getUserSettings: () =>
    request<{ telegram_channel: string; telegram_channel_default: string; whatsapp_channel_url: string; whatsapp_business_phone: string; shop_name: string; city: string }>(
      "/user-settings"
    ),
  updateUserSettings: (body: { telegram_channel?: string; whatsapp_channel_url?: string; whatsapp_business_phone?: string; shop_name?: string; city?: string }) =>
    request<{ telegram_channel: string; telegram_channel_default: string; whatsapp_channel_url: string; whatsapp_business_phone: string; shop_name: string; city: string }>(
      "/user-settings",
      { method: "PUT", body }
    ),
  telegramStatus: () =>
    request<{ configured: boolean; channel_id: string | null }>("/telegram/status"),

  // WhatsApp / Richiesta Info
  createShortLink: (body: { gen_id: string; image_index: number; look_name?: string }) =>
    request<{ short_id: string; look_name: string; public_url: string; tiny_url: string | null }>("/short-links", {
      method: "POST", body,
    }),
  listInfoRequests: (onlyNew = false) =>
    request<Array<{
      id: string; short_id: string; gen_id: string; image_index: number;
      look_name: string; customer_name?: string | null; phone?: string | null;
      message?: string | null; source: string; status: "new" | "read";
      created_at: string;
    }>>(`/info-requests${onlyNew ? "?only_new=true" : ""}`),
  infoRequestsUnreadCount: () =>
    request<{ count: number }>("/info-requests/unread-count"),
  markInfoRequestRead: (id: string) =>
    request<{ ok: boolean }>(`/info-requests/${id}/read`, { method: "POST", body: {} }),
  markAllInfoRequestsRead: () =>
    request<{ ok: boolean; updated: number }>("/info-requests/mark-all-read", { method: "POST", body: {} }),
  deleteInfoRequest: (id: string) =>
    request<{ ok: boolean }>(`/info-requests/${id}`, { method: "DELETE" }),

  // stats
  stats: () => request<any>("/stats"),
};
