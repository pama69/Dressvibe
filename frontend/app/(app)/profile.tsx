import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/contexts/AuthContext";
import { theme } from "@/src/theme";
import { GENDERS, AGES, BODIES, ETHNICITIES, Option } from "@/src/constants/options";

type Client = {
  id: string;
  name: string;
  model_gender: string;
  model_age: string;
  model_body: string;
  model_ethnicity: string;
  notes?: string | null;
};

function pickerRow(opts: Option[], value: string, onChange: (v: string) => void, prefix: string) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
      {opts.map((o) => {
        const a = value === o.value;
        return (
          <TouchableOpacity
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[s.chip, a && s.chipA]}
            testID={`${prefix}-${o.value}`}
          >
            <Text style={[s.chipT, a && s.chipTA]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

export default function Profile() {
  const { user, signOut } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [stats, setStats] = useState<{ garments: number; generations: number; clients: number } | null>(null);

  const [name, setName] = useState("");
  const [g, setG] = useState("donna");
  const [a, setA] = useState("adulto");
  const [b, setB] = useState("slim");
  const [e, setE] = useState("caucasica");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, st] = await Promise.all([api.listClients(), api.stats()]);
      setClients(c);
      setStats(st);
    } catch (err) {
      console.warn(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleCreate = async () => {
    if (!name.trim()) return Alert.alert("Nome richiesto", "Inserisci un nome per il cliente virtuale.");
    setSaving(true);
    try {
      await api.createClient({
        name: name.trim(), model_gender: g, model_age: a, model_body: b, model_ethnicity: e, notes: notes.trim() || null,
      });
      setName(""); setNotes(""); setShowForm(false);
      load();
    } catch (err: any) {
      Alert.alert("Errore", err?.message || "Impossibile salvare");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert("Eliminare?", "Vuoi rimuovere questo cliente virtuale?", [
      { text: "Annulla", style: "cancel" },
      {
        text: "Elimina", style: "destructive",
        onPress: async () => { try { await api.deleteClient(id); load(); } catch {} },
      },
    ]);
  };

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Text style={s.eyebrow}>PROFILO</Text>
          <Text style={s.title}>{user?.name || "Atelier"}</Text>
          <Text style={s.email}>{user?.email}</Text>
        </View>

        {/* Stats */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statNum}>{stats?.garments ?? "—"}</Text>
            <Text style={s.statLab}>Capi</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statNum}>{stats?.generations ?? "—"}</Text>
            <Text style={s.statLab}>Outfit</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statNum}>{stats?.clients ?? "—"}</Text>
            <Text style={s.statLab}>Clienti</Text>
          </View>
        </View>

        {/* Clienti virtuali */}
        <View style={s.section}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>Clienti Virtuali</Text>
            <TouchableOpacity onPress={() => setShowForm((v) => !v)} testID="toggle-client-form">
              <Text style={s.sectionAdd}>{showForm ? "Annulla" : "+ Nuovo"}</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.sectionSub}>
            Salva i modelli preferiti per ogni cliente reale del tuo negozio.
          </Text>

          {showForm && (
            <View style={s.form}>
              <TextInput
                value={name} onChangeText={setName}
                placeholder="Nome cliente (es. Maria Rossi)"
                placeholderTextColor={theme.colors.textMuted}
                style={s.input}
                testID="client-name-input"
              />
              <Text style={s.formLabel}>Genere</Text>
              {pickerRow(GENDERS, g, setG, "client-gender")}
              <Text style={s.formLabel}>Età</Text>
              {pickerRow(AGES, a, setA, "client-age")}
              <Text style={s.formLabel}>Corporatura</Text>
              {pickerRow(BODIES, b, setB, "client-body")}
              <Text style={s.formLabel}>Etnia</Text>
              {pickerRow(ETHNICITIES, e, setE, "client-eth")}
              <TextInput
                value={notes} onChangeText={setNotes} placeholder="Note (opzionale)"
                placeholderTextColor={theme.colors.textMuted}
                style={s.input}
                testID="client-notes-input"
              />
              <TouchableOpacity
                onPress={handleCreate}
                style={s.saveBtn}
                disabled={saving}
                testID="client-save-btn"
              >
                {saving
                  ? <ActivityIndicator color={theme.colors.primaryFg} />
                  : <Text style={s.saveBtnText}>Salva Cliente</Text>}
              </TouchableOpacity>
            </View>
          )}

          {loading ? null : clients.length === 0 ? (
            <Text style={s.empty}>Nessun cliente salvato.</Text>
          ) : (
            clients.map((c) => (
              <View key={c.id} style={s.clientCard} testID={`client-${c.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={s.clientName}>{c.name}</Text>
                  <Text style={s.clientMeta}>
                    {c.model_gender} · {c.model_age} · {c.model_body} · {c.model_ethnicity}
                  </Text>
                  {c.notes ? <Text style={s.clientNotes}>{c.notes}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => handleDelete(c.id)} testID={`client-delete-${c.id}`}>
                  <Ionicons name="trash-outline" size={18} color={theme.colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        <TouchableOpacity
          style={s.logout}
          onPress={() => {
            Alert.alert("Esci", "Vuoi disconnetterti?", [
              { text: "Annulla", style: "cancel" },
              { text: "Esci", style: "destructive", onPress: signOut },
            ]);
          }}
          testID="logout-button"
        >
          <Ionicons name="log-out-outline" size={18} color={theme.colors.error} />
          <Text style={s.logoutText}>Esci dall'account</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 16 },
  eyebrow: { color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 3 },
  title: { color: theme.colors.text, fontSize: 28, fontWeight: "300", letterSpacing: -0.5, marginTop: 6 },
  email: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 },
  statsRow: { flexDirection: "row", paddingHorizontal: 24, gap: 10 },
  statCard: { flex: 1, padding: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  statNum: { color: theme.colors.text, fontSize: 22, fontWeight: "500" },
  statLab: { color: theme.colors.textSecondary, fontSize: 11, letterSpacing: 1, marginTop: 4 },
  section: { paddingHorizontal: 24, marginTop: 32 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { color: theme.colors.text, fontSize: 14, letterSpacing: 1, textTransform: "uppercase" },
  sectionAdd: { color: theme.colors.text, fontSize: 13, fontWeight: "500" },
  sectionSub: { color: theme.colors.textSecondary, fontSize: 12, marginTop: 4, marginBottom: 16, lineHeight: 18 },
  form: { gap: 10, padding: 14, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 14 },
  formLabel: { color: theme.colors.textSecondary, fontSize: 10, letterSpacing: 2 },
  input: { backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, padding: 12, fontSize: 14 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.bg },
  chipA: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  chipT: { color: theme.colors.text, fontSize: 12 },
  chipTA: { color: theme.colors.primaryFg, fontWeight: "600" },
  saveBtn: { marginTop: 6, paddingVertical: 14, alignItems: "center", backgroundColor: theme.colors.text },
  saveBtnText: { color: theme.colors.primaryFg, fontWeight: "600", letterSpacing: 0.4 },
  empty: { color: theme.colors.textMuted, fontSize: 13, paddingVertical: 12 },
  clientCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: theme.colors.surface, padding: 14, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8,
  },
  clientName: { color: theme.colors.text, fontSize: 14, fontWeight: "500" },
  clientMeta: { color: theme.colors.textSecondary, fontSize: 11, marginTop: 4 },
  clientNotes: { color: theme.colors.textMuted, fontSize: 11, marginTop: 4, fontStyle: "italic" },
  logout: {
    marginTop: 40, marginHorizontal: 24, padding: 16, borderWidth: 1, borderColor: theme.colors.border,
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10,
  },
  logoutText: { color: theme.colors.error, fontSize: 14, fontWeight: "500" },
});
