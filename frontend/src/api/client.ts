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
  options: { method?: string; body?: any; auth?: boolean } = {}
): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (auth) {
    const token = await getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    let detail = txt;
    try {
      detail = JSON.parse(txt).detail || txt;
    } catch {}
    throw new Error(detail || `Request failed: ${res.status}`);
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
    request<any>("/generations", { method: "POST", body: g }),
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
    }),

  // clients
  listClients: () => request<any[]>("/clients"),
  createClient: (c: any) =>
    request<any>("/clients", { method: "POST", body: c }),
  deleteClient: (id: string) =>
    request<any>(`/clients/${id}`, { method: "DELETE" }),

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
  }) => request<any>("/videos", { method: "POST", body }),

  // caption
  caption: (body: any) =>
    request<{ caption: string }>("/caption", { method: "POST", body }),

  // telegram
  telegramPublish: (body: {
    image_base64: string;
    caption?: string;
    gen_id?: string;
    image_index?: number;
  }) =>
    request<{ ok: boolean; channel_message_id: number; token: string }>(
      "/telegram/publish",
      { method: "POST", body }
    ),
  telegramStatus: () =>
    request<{ configured: boolean; channel_id: string | null }>("/telegram/status"),

  // stats
  stats: () => request<any>("/stats"),
};
