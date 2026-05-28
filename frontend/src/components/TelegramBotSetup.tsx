import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { theme } from "@/src/theme";
import { useNotify } from "@/src/contexts/ConfirmContext";

/**
 * Self-contained Telegram bot onboarding flow used inside Profile.
 *
 * Flow (top → bottom):
 *  1. Terms acceptance — required, modal blocks the rest until accepted
 *  2. "Aggiungi @instapost_mybot al canale" — one-tap deep link
 *  3. Inserisci handle del canale + tasto "Verifica" — backend chiama
 *     getChat + getChatMember per confermare che il bot è admin con post
 *  4. Salva canale — abilita la pubblicazione
 *
 * The component fetches its own settings so it can decide what step to show
 * without forcing the parent to track all the state.
 */
export default function TelegramBotSetup() {
  const notify = useNotify();

  const [loading, setLoading] = useState(true);
  const [savedChannel, setSavedChannel] = useState("");
  const [channelInput, setChannelInput] = useState("");
  const [termsVersion, setTermsVersion] = useState<string | null>(null);
  const [termsAcceptedAt, setTermsAcceptedAt] = useState<string | null>(null);
  const [termsCurrent, setTermsCurrent] = useState<string>("v1.0");

  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [botDeepLink, setBotDeepLink] = useState<string | null>(null);

  const [verifyBusy, setVerifyBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState<null | {
    ok: boolean;
    admin?: boolean;
    can_post?: boolean;
    channel?: string;
    channel_title?: string;
    error?: string;
  }>(null);

  const [showTerms, setShowTerms] = useState(false);
  const [termsScrolledToEnd, setTermsScrolledToEnd] = useState(false);
  const [acceptingTerms, setAcceptingTerms] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settings, bot] = await Promise.all([
        api.getUserSettings(),
        api.telegramBotInfo().catch(() => null),
      ]);
      setSavedChannel(settings.telegram_channel || "");
      setChannelInput(settings.telegram_channel || "");
      setTermsVersion(settings.telegram_terms_version);
      setTermsAcceptedAt(settings.telegram_terms_accepted_at);
      setTermsCurrent(settings.telegram_terms_current_version || "v1.0");
      if (bot?.configured) {
        setBotUsername(bot.username || "instapost_mybot");
        setBotDeepLink(bot.deep_link_add_to_channel || null);
      } else {
        setBotUsername("instapost_mybot");
        setBotDeepLink(null);
      }
    } catch (e: any) {
      notify({ title: "Errore", message: e?.message || "Impossibile caricare il setup Telegram." });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const termsAccepted = !!termsAcceptedAt && termsVersion === termsCurrent;

  const openTelegramAddBot = async () => {
    if (!botDeepLink) {
      notify({
        title: "Bot non disponibile",
        message: "Riprova fra qualche istante.",
      });
      return;
    }
    try {
      if (Platform.OS === "web") {
        if (typeof window !== "undefined") window.open(botDeepLink, "_blank");
      } else {
        await Linking.openURL(botDeepLink);
      }
    } catch {
      notify({
        title: "Impossibile aprire Telegram",
        message: `Apri manualmente:\n${botDeepLink}`,
      });
    }
  };

  const verify = async () => {
    if (!channelInput.trim()) {
      notify({ title: "Indica il canale", message: "Scrivi @nomecanale prima di verificare." });
      return;
    }
    setVerifyBusy(true);
    setVerifyResult(null);
    try {
      const r = await api.telegramVerifyChannel(channelInput.trim());
      setVerifyResult(r);
      if (!r.ok) {
        notify({ title: "Verifica fallita", message: r.error || "Il bot non risulta nel canale." });
      } else if (!r.admin) {
        notify({
          title: "Bot presente ma NON admin",
          message: "Apri il canale → Amministratori → aggiungi @" + botUsername + " come amministratore con permesso di pubblicare.",
        });
      } else if (!r.can_post) {
        notify({
          title: "Manca il permesso di pubblicare",
          message: "Il bot è admin ma non ha il permesso 'Pubblica messaggi'. Modifica i suoi permessi nel canale.",
        });
      }
    } catch (e: any) {
      setVerifyResult({ ok: false, error: e?.message });
      notify({ title: "Errore di rete", message: e?.message || "Riprova fra poco." });
    } finally {
      setVerifyBusy(false);
    }
  };

  const save = async () => {
    if (!verifyResult?.ok || !verifyResult?.admin || !verifyResult?.can_post) {
      notify({ title: "Verifica richiesta", message: "Premi 'Verifica' prima di salvare." });
      return;
    }
    setSaveBusy(true);
    try {
      const s = await api.updateUserSettings({ telegram_channel: channelInput.trim() });
      setSavedChannel(s.telegram_channel || "");
      notify({
        title: "Canale collegato ✅",
        message: `Le prossime pubblicazioni andranno su ${verifyResult.channel_title || s.telegram_channel}.`,
      });
    } catch (e: any) {
      notify({ title: "Errore", message: e?.message || "Impossibile salvare il canale" });
    } finally {
      setSaveBusy(false);
    }
  };

  const acceptTerms = async () => {
    setAcceptingTerms(true);
    try {
      const r = await api.telegramAcceptTerms();
      setTermsVersion(r.version);
      setTermsAcceptedAt(r.accepted_at);
      setShowTerms(false);
      notify({
        title: "Termini accettati ✅",
        message: "Ora puoi collegare il tuo canale Telegram.",
      });
    } catch (e: any) {
      notify({ title: "Errore", message: e?.message || "Impossibile registrare l'accettazione" });
    } finally {
      setAcceptingTerms(false);
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
      <Text style={st.title}>📣 Pubblicazione su Telegram</Text>
      <Text style={st.hint}>
        DressVibe usa il bot <Text style={st.bold}>@{botUsername}</Text> per pubblicare automaticamente sul tuo canale.
        Bastano 3 passi: accetta i termini, aggiungi il bot come admin, verifica.
      </Text>

      {/* STEP 1 — Terms */}
      <View style={[st.step, termsAccepted ? st.stepDone : st.stepActive]}>
        <View style={st.stepHeader}>
          <View style={[st.stepBadge, termsAccepted ? st.stepBadgeDone : st.stepBadgeActive]}>
            <Text style={st.stepBadgeText}>{termsAccepted ? "✓" : "1"}</Text>
          </View>
          <Text style={st.stepTitle}>Termini e condizioni del bot</Text>
        </View>
        {termsAccepted ? (
          <Text style={st.stepDoneText}>
            Accettati il {termsAcceptedAt ? new Date(termsAcceptedAt).toLocaleDateString("it-IT") : "—"} (versione {termsVersion}).
          </Text>
        ) : (
          <>
            <Text style={st.stepDesc}>
              Prima di usare il bot devi leggere e accettare i termini d'uso.
            </Text>
            <TouchableOpacity
              onPress={() => { setTermsScrolledToEnd(false); setShowTerms(true); }}
              style={st.primaryBtn}
              testID="tg-terms-open"
              activeOpacity={0.85}
            >
              <Ionicons name="document-text-outline" size={16} color="#000" />
              <Text style={st.primaryBtnText}>Leggi e accetta i termini</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* STEP 2 — Add bot to channel (only after terms) */}
      <View style={[st.step, !termsAccepted ? st.stepLocked : (savedChannel ? st.stepDone : st.stepActive)]}>
        <View style={st.stepHeader}>
          <View style={[
            st.stepBadge,
            !termsAccepted ? st.stepBadgeLocked : (savedChannel ? st.stepBadgeDone : st.stepBadgeActive),
          ]}>
            <Text style={st.stepBadgeText}>{!termsAccepted ? "🔒" : (savedChannel ? "✓" : "2")}</Text>
          </View>
          <Text style={st.stepTitle}>Aggiungi @{botUsername} al canale</Text>
        </View>
        {!termsAccepted ? (
          <Text style={st.stepDesc}>Sbloccato dopo l'accettazione dei termini.</Text>
        ) : (
          <>
            <Text style={st.stepDesc}>
              Tocca il pulsante: Telegram ti mostrerà la lista dei tuoi canali per aggiungere il bot come amministratore con permesso di "Pubblicare messaggi".
            </Text>
            <TouchableOpacity
              onPress={openTelegramAddBot}
              disabled={!botDeepLink}
              style={[st.primaryBtn, !botDeepLink && { opacity: 0.5 }]}
              testID="tg-add-bot"
              activeOpacity={0.85}
            >
              <Ionicons name="paper-plane" size={16} color="#000" />
              <Text style={st.primaryBtnText}>Aggiungi il bot al mio canale</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* STEP 3 — Verify channel handle */}
      <View style={[st.step, !termsAccepted ? st.stepLocked : st.stepActive]}>
        <View style={st.stepHeader}>
          <View style={[
            st.stepBadge,
            !termsAccepted ? st.stepBadgeLocked : (verifyResult?.ok && verifyResult.admin && verifyResult.can_post ? st.stepBadgeDone : st.stepBadgeActive),
          ]}>
            <Text style={st.stepBadgeText}>
              {!termsAccepted ? "🔒" : (verifyResult?.ok && verifyResult.admin && verifyResult.can_post ? "✓" : "3")}
            </Text>
          </View>
          <Text style={st.stepTitle}>Verifica e salva il canale</Text>
        </View>
        {!termsAccepted ? (
          <Text style={st.stepDesc}>Sbloccato dopo l'accettazione dei termini.</Text>
        ) : (
          <>
            <Text style={st.stepDesc}>
              Scrivi qui sotto il nome del tuo canale (es. <Text style={st.bold}>@frammenti_pe</Text>) e premi "Verifica".
            </Text>
            <TextInput
              value={channelInput}
              onChangeText={(t) => { setChannelInput(t); setVerifyResult(null); }}
              placeholder="@nomecanale"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={st.input}
              testID="tg-channel-input"
            />
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <TouchableOpacity
                onPress={verify}
                disabled={verifyBusy || !channelInput.trim()}
                style={[st.secondaryBtn, (verifyBusy || !channelInput.trim()) && { opacity: 0.5 }]}
                testID="tg-verify"
                activeOpacity={0.85}
              >
                {verifyBusy
                  ? <ActivityIndicator color={theme.colors.text} />
                  : (<>
                      <Ionicons name="shield-checkmark-outline" size={15} color={theme.colors.text} />
                      <Text style={st.secondaryBtnText}>Verifica</Text>
                    </>)
                }
              </TouchableOpacity>
              <TouchableOpacity
                onPress={save}
                disabled={saveBusy || !verifyResult?.ok || !verifyResult?.admin || !verifyResult?.can_post}
                style={[
                  st.primaryBtn,
                  (saveBusy || !verifyResult?.ok || !verifyResult?.admin || !verifyResult?.can_post) && { opacity: 0.5 },
                ]}
                testID="tg-save-channel"
                activeOpacity={0.85}
              >
                {saveBusy ? <ActivityIndicator color="#000" /> : (
                  <>
                    <Ionicons name="save-outline" size={16} color="#000" />
                    <Text style={st.primaryBtnText}>Salva canale</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Verify feedback */}
            {verifyResult ? (
              verifyResult.ok && verifyResult.admin && verifyResult.can_post ? (
                <View style={st.feedbackOk}>
                  <Text style={st.feedbackOkText}>
                    ✅ Bot collegato a <Text style={st.bold}>{verifyResult.channel_title}</Text>.
                    Puoi salvare.
                  </Text>
                </View>
              ) : (
                <View style={st.feedbackErr}>
                  <Text style={st.feedbackErrText}>
                    {verifyResult.error || "Il bot non è admin del canale con permesso di pubblicare."}
                  </Text>
                </View>
              )
            ) : null}

            {savedChannel ? (
              <Text style={st.savedLabel}>
                Canale attivo: <Text style={st.bold}>{savedChannel}</Text>
              </Text>
            ) : null}
          </>
        )}
      </View>

      {/* TERMS MODAL */}
      <Modal visible={showTerms} animationType="slide" transparent onRequestClose={() => setShowTerms(false)}>
        <View style={st.modalBackdrop}>
          <View style={st.modalCard}>
            <View style={st.modalHeader}>
              <Text style={st.modalTitle}>Termini d'uso bot Telegram</Text>
              <TouchableOpacity onPress={() => setShowTerms(false)} testID="tg-terms-close" hitSlop={8}>
                <Ionicons name="close" size={22} color={theme.colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={st.termsScroll}
              contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
              onScroll={(e) => {
                const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
                if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 24) {
                  setTermsScrolledToEnd(true);
                }
              }}
              scrollEventThrottle={32}
            >
              <Text style={st.termsVersion}>Versione {termsCurrent} — DressVibe</Text>
              <Text style={st.termsPara}>
                Utilizzando il bot <Text style={st.bold}>@{botUsername}</Text> per pubblicare contenuti sul tuo canale Telegram, accetti i seguenti termini:
              </Text>

              <Text style={st.termsH}>1. Responsabilità dei contenuti</Text>
              <Text style={st.termsPara}>
                Sei l'unico titolare e responsabile dei contenuti (foto, video, descrizioni, prezzi) che pubblichi tramite il bot.
                DressVibe non è responsabile per contenuti illeciti, lesivi di diritti d'autore, marchi o privacy di terzi.
              </Text>

              <Text style={st.termsH}>2. Dati raccolti dal bot</Text>
              <Text style={st.termsPara}>
                Il bot riceve solo gli eventi necessari a pubblicare i tuoi post (chat_id del canale, messaggi che ne derivano e le interazioni dei tuoi clienti con il pulsante "Richiedi info").
                Non raccogliamo conversazioni private dei tuoi follower.
              </Text>

              <Text style={st.termsH}>3. Rispetto delle regole Telegram</Text>
              <Text style={st.termsPara}>
                Dichiari di rispettare i Termini di Servizio Telegram (telegram.org/tos) e l'Acceptable Use Policy. Spam, frode, contenuti illegali o porno-grafici sono vietati e comportano la sospensione immediata dell'accesso al bot.
              </Text>

              <Text style={st.termsH}>4. Sospensione</Text>
              <Text style={st.termsPara}>
                DressVibe si riserva il diritto di sospendere o rimuovere l'accesso al bot in caso di uso improprio, comportamenti ripetuti che generino segnalazioni di spam, o violazione di queste regole.
              </Text>

              <Text style={st.termsH}>5. Contenuti generati da AI</Text>
              <Text style={st.termsPara}>
                Le immagini e i video generati da DressVibe utilizzano modelli AI a partire dalle tue fotografie originali.
                Garantisci di possedere o avere i diritti necessari sulle foto originali che carichi. I capi mostrati restano di tua proprietà e responsabilità commerciale.
              </Text>

              <Text style={st.termsH}>6. Privacy dei follower</Text>
              <Text style={st.termsPara}>
                I numeri di telefono e gli username dei follower che premono "Richiedi info" sul canale vengono inoltrati a te in app.
                Sei tenuto a trattarli nel rispetto del GDPR (informativa, finalità, base giuridica, conservazione limitata).
              </Text>

              <Text style={st.termsH}>7. Revoca</Text>
              <Text style={st.termsPara}>
                Puoi rimuovere il bot dal tuo canale Telegram in qualsiasi momento. Cancellando l'app o richiedendo la cancellazione del tuo account DressVibe, i dati associati vengono rimossi entro 30 giorni.
              </Text>

              <Text style={st.termsH}>8. Aggiornamento dei termini</Text>
              <Text style={st.termsPara}>
                Questi termini possono essere aggiornati. In caso di modifiche sostanziali, ti chiederemo di accettarli nuovamente prima di poter pubblicare.
              </Text>

              <Text style={[st.termsPara, { marginTop: 12, fontStyle: "italic" }]}>
                Premendo "Accetto" confermi di aver letto e accettato i termini soprastanti per la versione {termsCurrent}.
              </Text>
            </ScrollView>

            <View style={st.modalFooter}>
              <TouchableOpacity
                onPress={() => setShowTerms(false)}
                style={st.modalCancel}
                testID="tg-terms-cancel"
                activeOpacity={0.7}
              >
                <Text style={st.modalCancelText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={acceptTerms}
                disabled={!termsScrolledToEnd || acceptingTerms}
                style={[st.modalAccept, (!termsScrolledToEnd || acceptingTerms) && { opacity: 0.45 }]}
                testID="tg-terms-accept"
                activeOpacity={0.85}
              >
                {acceptingTerms ? <ActivityIndicator color="#000" /> : (
                  <Text style={st.modalAcceptText}>
                    {termsScrolledToEnd ? "Accetto" : "Scorri fino in fondo"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  block: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
    gap: 12,
  },
  title: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  bold: { fontWeight: "700", color: theme.colors.text },

  step: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    gap: 8,
    backgroundColor: theme.colors.bg,
  },
  stepActive: { borderColor: theme.colors.text },
  stepDone: { borderColor: "#1f7a3a" },
  stepLocked: { opacity: 0.6 },
  stepHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBadge: {
    width: 26, height: 26, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: theme.colors.border,
  },
  stepBadgeActive: { backgroundColor: theme.colors.text },
  stepBadgeDone: { backgroundColor: "#1f7a3a", borderColor: "#1f7a3a" },
  stepBadgeLocked: { backgroundColor: theme.colors.surface },
  stepBadgeText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  stepTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "700", flex: 1 },
  stepDesc: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  stepDoneText: { color: theme.colors.textSecondary, fontSize: 12 },

  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.text,
    paddingVertical: 11,
    paddingHorizontal: 16,
    minHeight: 44,
  },
  primaryBtnText: { color: "#000", fontSize: 13, fontWeight: "700", letterSpacing: 0.3 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: 11,
    paddingHorizontal: 14,
    backgroundColor: theme.colors.surface,
    minHeight: 44,
  },
  secondaryBtnText: { color: theme.colors.text, fontSize: 12, fontWeight: "700", letterSpacing: 0.3 },

  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    backgroundColor: theme.colors.surface,
  },

  feedbackOk: {
    backgroundColor: "rgba(31,122,58,0.12)",
    borderWidth: 1, borderColor: "#1f7a3a",
    padding: 10,
  },
  feedbackOkText: { color: theme.colors.text, fontSize: 12, lineHeight: 17 },
  feedbackErr: {
    backgroundColor: "rgba(225,29,72,0.10)",
    borderWidth: 1, borderColor: theme.colors.error,
    padding: 10,
  },
  feedbackErrText: { color: theme.colors.error, fontSize: 12, lineHeight: 17 },

  savedLabel: { color: theme.colors.textSecondary, fontSize: 11, marginTop: 4 },

  // Modal
  modalBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center", padding: 16,
  },
  modalCard: {
    backgroundColor: theme.colors.bg,
    borderWidth: 1, borderColor: theme.colors.border,
    maxHeight: "90%", overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
  },
  modalTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  termsScroll: { maxHeight: 480 },
  termsVersion: {
    color: theme.colors.textMuted, fontSize: 11, letterSpacing: 2,
    textTransform: "uppercase", marginBottom: 14,
  },
  termsH: { color: theme.colors.text, fontSize: 13, fontWeight: "700", marginTop: 14, marginBottom: 4 },
  termsPara: { color: theme.colors.textSecondary, fontSize: 12.5, lineHeight: 18 },
  modalFooter: {
    flexDirection: "row", gap: 10, padding: 14,
    borderTopWidth: 1, borderTopColor: theme.colors.border,
  },
  modalCancel: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingVertical: 12, borderWidth: 1, borderColor: theme.colors.border,
  },
  modalCancelText: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  modalAccept: {
    flex: 2, alignItems: "center", justifyContent: "center",
    paddingVertical: 12, backgroundColor: theme.colors.text,
  },
  modalAcceptText: { color: "#000", fontSize: 13, fontWeight: "700", letterSpacing: 0.3 },
});
