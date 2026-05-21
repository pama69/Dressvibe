/**
 * Lista delle richieste informazioni ricevute via WhatsApp / canale.
 * Aggiornata automaticamente al focus + pull-to-refresh.
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Linking,
  Platform,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { useNotifications } from "@/src/contexts/NotificationsContext";

type Req = {
  id: string;
  short_id: string;
  gen_id: string;
  image_index: number;
  look_name: string;
  customer_name?: string | null;
  phone?: string | null;
  message?: string | null;
  source: string;
  status: "new" | "read";
  created_at: string;
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diff < 60) return "ora";
    if (diff < 3600) return `${Math.floor(diff / 60)} min fa`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ore fa`;
    // Force display in Italian local time (Europe/Rome) regardless of the
    // device timezone — the shop owner is in Italy and expects local times,
    // not whatever the device clock is set to.
    return d.toLocaleString("it-IT", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      timeZone: "Europe/Rome",
    });
  } catch {
    return iso;
  }
}

export default function Notifications() {
  const router = useRouter();
  const { refresh: refreshBadge, markAllRead } = useNotifications();
  const [items, setItems] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.listInfoRequests();
      setItems(list);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const handleMarkRead = async (r: Req) => {
    if (r.status === "read") return;
    setItems((prev) => prev.map((x) => x.id === r.id ? { ...x, status: "read" } : x));
    try {
      await api.markInfoRequestRead(r.id);
      refreshBadge();
    } catch {}
  };

  const handleDelete = (r: Req) => {
    const proceed = async () => {
      setItems((prev) => prev.filter((x) => x.id !== r.id));
      try { await api.deleteInfoRequest(r.id); refreshBadge(); } catch {}
    };
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm("Eliminare questa richiesta?")) proceed();
    } else {
      Alert.alert("Eliminare?", "La richiesta sarà rimossa.", [
        { text: "Annulla", style: "cancel" },
        { text: "Elimina", style: "destructive", onPress: proceed },
      ]);
    }
  };

  const callCustomer = async (phone: string) => {
    try { await Linking.openURL(`tel:${phone.replace(/\s+/g, "")}`); } catch {}
  };

  const openWhatsApp = async (phone: string, look: string) => {
    const clean = phone.replace(/[^0-9+]/g, "").replace(/^\+/, "");
    const text = encodeURIComponent(`Ciao! Hai chiesto informazioni su "${look}". Eccoci 👋`);
    try { await Linking.openURL(`https://wa.me/${clean}?text=${text}`); } catch {}
  };

  const copyMessage = async (r: Req) => {
    const lines = [
      r.customer_name ? `Cliente: ${r.customer_name}` : null,
      r.phone ? `Tel: ${r.phone}` : null,
      `Look: ${r.look_name}`,
      r.message ? `Messaggio: ${r.message}` : null,
    ].filter(Boolean);
    await Clipboard.setStringAsync(lines.join("\n"));
    if (Platform.OS === "web") { try { (globalThis as any).alert?.("Copiato negli appunti"); } catch {} }
  };

  const onMarkAllPress = async () => {
    await markAllRead();
    setItems((prev) => prev.map((x) => ({ ...x, status: "read" as const })));
  };

  const newCount = items.filter((i) => i.status === "new").length;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn} testID="notif-back">
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>NOTIFICHE</Text>
          <Text style={s.title}>Richieste info</Text>
        </View>
        {newCount > 0 ? (
          <TouchableOpacity style={s.markAll} onPress={onMarkAllPress} testID="notif-mark-all">
            <Text style={s.markAllText}>Segna tutte</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <View style={s.loading}><ActivityIndicator color={theme.colors.text} /></View>
      ) : items.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="notifications-off-outline" size={42} color={theme.colors.textMuted} />
          <Text style={s.emptyTitle}>Nessuna richiesta ancora</Text>
          <Text style={s.emptySub}>
            Le richieste dei clienti dal canale WhatsApp appariranno qui.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 20, paddingBottom: 60, gap: 12 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.text} />
          }
          renderItem={({ item }) => (
            <View style={[s.card, item.status === "new" && s.cardNew]} testID={`req-${item.id}`}>
              <View style={s.cardHead}>
                <View style={s.sourceBadge}>
                  <Ionicons name="logo-whatsapp" size={11} color="#25D366" />
                  <Text style={s.sourceText}>{item.source}</Text>
                </View>
                <Text style={s.cardDate}>{formatTime(item.created_at)}</Text>
              </View>

              <Text style={s.lookName}>{item.look_name}</Text>

              <View style={s.row}>
                <View style={{ flex: 1, gap: 4 }}>
                  {item.customer_name ? (
                    <View style={s.rowLine}>
                      <Ionicons name="person-outline" size={13} color={theme.colors.textSecondary} />
                      <Text style={s.rowText}>{item.customer_name}</Text>
                    </View>
                  ) : null}
                  {item.phone ? (
                    <View style={s.rowLine}>
                      <Ionicons name="call-outline" size={13} color={theme.colors.textSecondary} />
                      <Text style={s.rowText}>{item.phone}</Text>
                    </View>
                  ) : null}
                  {item.message ? (
                    <View style={s.rowLine}>
                      <Ionicons name="chatbubble-outline" size={13} color={theme.colors.textSecondary} />
                      <Text style={[s.rowText, { flex: 1, lineHeight: 18 }]}>{item.message}</Text>
                    </View>
                  ) : null}
                </View>
                <Image
                  source={{ uri: `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/r/${item.short_id}/image` }}
                  style={s.thumb}
                  resizeMode="cover"
                />
              </View>

              <View style={s.actions}>
                {item.phone ? (
                  <>
                    <TouchableOpacity style={s.actBtn} onPress={() => callCustomer(item.phone!)} testID={`call-${item.id}`}>
                      <Ionicons name="call-outline" size={14} color={theme.colors.text} />
                      <Text style={s.actText}>Chiama</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.actBtn} onPress={() => openWhatsApp(item.phone!, item.look_name)} testID={`wa-${item.id}`}>
                      <Ionicons name="logo-whatsapp" size={14} color="#25D366" />
                      <Text style={s.actText}>WhatsApp</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
                <TouchableOpacity style={s.actBtn} onPress={() => copyMessage(item)}>
                  <Ionicons name="copy-outline" size={14} color={theme.colors.text} />
                  <Text style={s.actText}>Copia</Text>
                </TouchableOpacity>
                {item.status === "new" ? (
                  <TouchableOpacity style={s.actBtnPrimary} onPress={() => handleMarkRead(item)} testID={`read-${item.id}`}>
                    <Text style={s.actTextPrimary}>Segna letta</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={s.actBtnGhost} onPress={() => handleDelete(item)} testID={`del-${item.id}`}>
                  <Ionicons name="trash-outline" size={14} color={theme.colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  iconBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  eyebrow: { color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 2.5 },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: "300", letterSpacing: -0.4, marginTop: 2 },
  markAll: {
    paddingVertical: 6, paddingHorizontal: 10,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  markAllText: { color: theme.colors.text, fontSize: 11, letterSpacing: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 },
  emptyTitle: { color: theme.colors.text, fontSize: 16 },
  emptySub: { color: theme.colors.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 19 },
  card: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border,
    padding: 14, gap: 10,
  },
  cardNew: {
    borderColor: "#25D366",
    backgroundColor: "rgba(37,211,102,0.06)",
  },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sourceBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingVertical: 4, paddingHorizontal: 8,
    borderWidth: 1, borderColor: "#25D36644",
    backgroundColor: "rgba(37,211,102,0.08)",
  },
  sourceText: { color: "#25D366", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontWeight: "600" },
  cardDate: { color: theme.colors.textMuted, fontSize: 11 },
  lookName: { color: theme.colors.text, fontSize: 16, fontWeight: "500", letterSpacing: -0.2 },
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  rowLine: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  rowText: { color: theme.colors.textSecondary, fontSize: 13 },
  thumb: { width: 64, height: 80, backgroundColor: theme.colors.bg },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  actBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingVertical: 7, paddingHorizontal: 10,
    borderWidth: 1, borderColor: theme.colors.border,
  },
  actText: { color: theme.colors.text, fontSize: 11, letterSpacing: 0.4 },
  actBtnPrimary: {
    paddingVertical: 7, paddingHorizontal: 12,
    backgroundColor: theme.colors.text,
  },
  actTextPrimary: { color: theme.colors.primaryFg, fontSize: 11, fontWeight: "600", letterSpacing: 0.4 },
  actBtnGhost: {
    paddingVertical: 7, paddingHorizontal: 10,
    borderWidth: 1, borderColor: theme.colors.border,
    marginLeft: "auto",
  },
});
