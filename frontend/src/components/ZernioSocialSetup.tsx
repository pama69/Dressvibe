import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { useNotify } from "@/src/contexts/ConfirmContext";

/**
 * Connects the shop owner's Instagram + Facebook accounts to DressVibe via
 * Zernio's hosted OAuth. Renders a single block inside Profile with one
 * card per platform: when not connected it shows "Collega"; when connected
 * it shows username + follower count.
 */
type PlatformId = "instagram" | "facebook";

const PLATFORMS: { id: PlatformId; label: string; emoji: string; color: string }[] = [
  { id: "instagram", label: "Instagram", emoji: "📷", color: "#dd2a7b" },
  { id: "facebook", label: "Facebook", emoji: "📘", color: "#1877F2" },
];

export default function ZernioSocialSetup() {
  const notify = useNotify();
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [platforms, setPlatforms] = useState<Record<string, any>>({});
  const [connectBusy, setConnectBusy] = useState<PlatformId | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.zernioStatus();
      setConfigured(r.configured);
      setPlatforms(r.platforms || {});
    } catch (e: any) {
      // 401/network — keep silent, block stays "loading"
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Re-fetch when user returns from the browser (after OAuth)
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const connect = async (p: PlatformId) => {
    setConnectBusy(p);
    try {
      const r = await api.zernioConnectUrl(p);
      if (!r?.auth_url) {
        notify({ title: "Errore", message: "Zernio non ha restituito l'URL di autorizzazione" });
        return;
      }
      if (Platform.OS === "web") {
        if (typeof window !== "undefined") window.open(r.auth_url, "_blank");
      } else {
        await Linking.openURL(r.auth_url);
      }
      // After OAuth the user comes back to the app; useFocusEffect will
      // refresh the status.
      notify({
        title: "Apri il browser per autorizzare",
        message: `Completa l'accesso a ${p === "instagram" ? "Instagram" : "Facebook"} nel browser, poi torna qui.`,
      });
    } catch (e: any) {
      notify({ title: "Errore", message: e?.message || "Impossibile generare il link di collegamento" });
    } finally {
      setConnectBusy(null);
    }
  };

  if (loading) {
    return (
      <View style={st.block}>
        <ActivityIndicator color={theme.colors.text} />
      </View>
    );
  }

  return (
    <View style={st.block}>
      <Text style={st.title}>📱 Pubblicazione automatica sui Social</Text>
      <Text style={st.hint}>
        Collega Instagram e Facebook una volta sola: da qui in poi i look generati si pubblicano direttamente con un tap dallo Studio.
      </Text>

      {!configured ? (
        <View style={st.notReady}>
          <Text style={st.notReadyText}>
            Servizio non configurato sul server. Contatta il supporto.
          </Text>
        </View>
      ) : (
        <View style={st.platformList}>
          {PLATFORMS.map((p) => {
            const acct = platforms[p.id];
            return (
              <View key={p.id} style={[st.card, acct && st.cardConnected]}>
                <View style={st.cardLeft}>
                  <Text style={[st.cardEmoji, { color: p.color }]}>{p.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={st.cardLabel}>{p.label}</Text>
                    {acct ? (
                      <>
                        <Text style={st.cardName}>
                          @{acct.username || acct.display_name || "account"}
                        </Text>
                        {acct.followers ? (
                          <Text style={st.cardSub}>
                            {acct.followers.toLocaleString("it-IT")} follower
                          </Text>
                        ) : null}
                      </>
                    ) : (
                      <Text style={st.cardSub}>Non collegato</Text>
                    )}
                  </View>
                </View>

                {acct ? (
                  <View style={st.connectedPill}>
                    <Ionicons name="checkmark-circle" size={14} color="#1f7a3a" />
                    <Text style={st.connectedPillText}>Collegato</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => connect(p.id)}
                    disabled={connectBusy === p.id}
                    style={[st.connectBtn, connectBusy === p.id && { opacity: 0.5 }]}
                    testID={`zernio-connect-${p.id}`}
                    activeOpacity={0.85}
                  >
                    {connectBusy === p.id ? (
                      <ActivityIndicator color="#000" />
                    ) : (
                      <>
                        <Ionicons name="link-outline" size={15} color="#000" />
                        <Text style={st.connectBtnText}>Collega</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}

      <Text style={st.footnote}>
        I tuoi account social vengono autorizzati via OAuth ufficiale Meta (powered by Zernio). DressVibe non vede mai la tua password.
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  block: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border,
    padding: 16, gap: 12,
  },
  title: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },

  notReady: {
    padding: 10, borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
  },
  notReadyText: { color: theme.colors.error, fontSize: 12 },

  platformList: { gap: 8 },
  card: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 12,
    borderWidth: 1, borderColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
    gap: 12,
  },
  cardConnected: { borderColor: "#1f7a3a" },
  cardLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  cardEmoji: { fontSize: 22 },
  cardLabel: {
    color: theme.colors.textMuted, fontSize: 10, letterSpacing: 2,
    textTransform: "uppercase",
  },
  cardName: { color: theme.colors.text, fontSize: 14, fontWeight: "700", marginTop: 2 },
  cardSub: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },

  connectBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: theme.colors.text,
    paddingVertical: 9, paddingHorizontal: 14,
    minHeight: 40,
  },
  connectBtnText: { color: "#000", fontSize: 12, fontWeight: "700", letterSpacing: 0.3 },
  connectedPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: "rgba(31,122,58,0.12)",
    borderWidth: 1, borderColor: "#1f7a3a",
  },
  connectedPillText: { color: "#1f7a3a", fontSize: 11, fontWeight: "700" },

  footnote: { color: theme.colors.textMuted, fontSize: 10, lineHeight: 14, fontStyle: "italic" },
});
