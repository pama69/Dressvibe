/**
 * Combined email/password authentication screen.
 *
 * Switches between 5 internal modes via local state — no need for 5 separate
 * routes. The router only ever points to /email-auth (with an optional
 * ?mode=register query param) which keeps the navigation stack shallow.
 *
 *   - login              email + password → calls POST /auth/email/login
 *   - register           email + password + name → POST /auth/email/register
 *   - verify             6-digit OTP → POST /auth/email/verify
 *   - forgot             email only → POST /auth/email/forgot
 *   - reset              email + OTP + new password → POST /auth/email/reset
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/contexts/AuthContext";
import { useNotify } from "@/src/contexts/ConfirmContext";
import { theme, MAGIC_GRADIENT } from "@/src/theme";

type Mode = "login" | "register" | "verify" | "forgot" | "reset";

export default function EmailAuth() {
  const router = useRouter();
  const { mode: initialMode } = useLocalSearchParams<{ mode?: string }>();
  const { signInWithToken } = useAuth();
  const notify = useNotify();

  const [mode, setMode] = useState<Mode>(
    initialMode === "register" ? "register" : "login"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // ---------- Submit handlers ----------
  const doRegister = async () => {
    setBusy(true);
    try {
      const res = await api.emailRegister({ email: email.trim().toLowerCase(), password, name: name.trim() });
      // DEV-only fallback: surface the OTP if Resend isn't configured.
      if (res?.dev_otp) {
        notify({ title: "DEV: codice OTP", message: `${res.dev_otp} (Resend non configurato)` });
      } else {
        notify({ title: "Codice inviato 📧", message: "Controlla la tua casella email per il codice di verifica a 6 cifre." });
      }
      setCode("");
      setMode("verify");
    } catch (e: any) {
      notify({ title: "Registrazione non riuscita", message: e?.message || "Riprova" });
    } finally {
      setBusy(false);
    }
  };

  const doVerify = async () => {
    setBusy(true);
    try {
      const res = await api.emailVerify({ email: email.trim().toLowerCase(), code: code.trim() });
      await signInWithToken(res.session_token, res.user);
      router.replace("/(app)");
    } catch (e: any) {
      notify({ title: "Verifica non riuscita", message: e?.message || "Codice non valido" });
    } finally {
      setBusy(false);
    }
  };

  const doLogin = async () => {
    setBusy(true);
    try {
      const res = await api.emailLogin({ email: email.trim().toLowerCase(), password });
      await signInWithToken(res.session_token, res.user);
      router.replace("/(app)");
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.includes("non ancora verificato")) {
        // Help the user recover with one tap
        notify({ title: "Account non verificato", message: "Ti reindirizzo all'inserimento del codice." });
        setMode("verify");
        try { await api.emailResendCode({ email: email.trim().toLowerCase(), purpose: "verify" }); } catch {}
      } else {
        notify({ title: "Accesso non riuscito", message: msg || "Riprova" });
      }
    } finally {
      setBusy(false);
    }
  };

  const doForgot = async () => {
    setBusy(true);
    try {
      await api.emailForgot({ email: email.trim().toLowerCase() });
      notify({ title: "Email inviata 📧", message: "Se questa email è registrata riceverai a breve un codice per reimpostare la password." });
      setMode("reset");
      setCode("");
      setNewPassword("");
    } catch (e: any) {
      notify({ title: "Errore", message: e?.message || "Riprova" });
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    setBusy(true);
    try {
      await api.emailReset({ email: email.trim().toLowerCase(), code: code.trim(), password: newPassword });
      notify({ title: "Password aggiornata ✓", message: "Accedi con la nuova password." });
      setMode("login");
      setPassword("");
    } catch (e: any) {
      notify({ title: "Reset non riuscito", message: e?.message || "Riprova" });
    } finally {
      setBusy(false);
    }
  };

  const doResendCode = async (purpose: "verify" | "reset") => {
    try {
      await api.emailResendCode({ email: email.trim().toLowerCase(), purpose });
      notify({ title: "Codice rinviato 📧", message: "Controlla la casella email." });
    } catch (e: any) {
      notify({ title: "Errore", message: e?.message || "Riprova fra qualche istante" });
    }
  };

  // ---------- Render ----------
  const title =
    mode === "register" ? "Crea il tuo account" :
    mode === "verify" ? "Verifica la tua email" :
    mode === "forgot" ? "Password dimenticata" :
    mode === "reset" ? "Reimposta la password" :
    "Accedi";

  const subtitle =
    mode === "register" ? "Crea un account DressVibe con la tua email." :
    mode === "verify" ? `Inserisci il codice a 6 cifre inviato a ${email}.` :
    mode === "forgot" ? "Inserisci la tua email per ricevere un codice di reset." :
    mode === "reset" ? `Inserisci il codice ricevuto a ${email} e la nuova password.` :
    "Usa la tua email e password.";

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={s.back} hitSlop={12} testID="email-auth-back">
            <Text style={s.backArrow}>‹  indietro</Text>
          </TouchableOpacity>
          <Text style={s.brand}>DressVibe</Text>
          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>{subtitle}</Text>

          {/* Email field — visible in all modes except 'verify' (already known) */}
          {mode !== "verify" && mode !== "reset" && (
            <View style={s.field}>
              <Text style={s.label}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="tu@negozio.it"
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                style={s.input}
                testID="email-input"
              />
            </View>
          )}

          {mode === "register" && (
            <View style={s.field}>
              <Text style={s.label}>Nome (facoltativo)</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Nome del tuo negozio"
                placeholderTextColor={theme.colors.textMuted}
                style={s.input}
                testID="name-input"
              />
            </View>
          )}

          {(mode === "login" || mode === "register") && (
            <View style={s.field}>
              <Text style={s.label}>Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="almeno 8 caratteri"
                placeholderTextColor={theme.colors.textMuted}
                secureTextEntry
                style={s.input}
                testID="password-input"
              />
            </View>
          )}

          {(mode === "verify" || mode === "reset") && (
            <View style={s.field}>
              <Text style={s.label}>Codice a 6 cifre</Text>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="number-pad"
                style={[s.input, s.inputOtp]}
                maxLength={6}
                testID="code-input"
              />
              <TouchableOpacity
                onPress={() => doResendCode(mode === "verify" ? "verify" : "reset")}
                style={{ alignSelf: "flex-end", marginTop: 6 }}
              >
                <Text style={s.link}>Reinvia codice</Text>
              </TouchableOpacity>
            </View>
          )}

          {mode === "reset" && (
            <View style={s.field}>
              <Text style={s.label}>Nuova password</Text>
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="almeno 8 caratteri"
                placeholderTextColor={theme.colors.textMuted}
                secureTextEntry
                style={s.input}
                testID="new-password-input"
              />
            </View>
          )}

          {/* Primary action */}
          <TouchableOpacity
            onPress={
              mode === "register" ? doRegister :
              mode === "verify" ? doVerify :
              mode === "forgot" ? doForgot :
              mode === "reset" ? doReset :
              doLogin
            }
            disabled={busy}
            activeOpacity={0.85}
            style={{ marginTop: 18 }}
            testID="primary-action"
          >
            <LinearGradient
              colors={MAGIC_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[s.primaryBtn, busy && { opacity: 0.5 }]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.primaryText}>
                  {mode === "register" ? "Crea account"
                   : mode === "verify" ? "Verifica e accedi"
                   : mode === "forgot" ? "Invia codice"
                   : mode === "reset" ? "Reimposta password"
                   : "Accedi"}
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* Secondary links / mode switches */}
          <View style={s.links}>
            {mode === "login" && (
              <>
                <TouchableOpacity onPress={() => setMode("forgot")}>
                  <Text style={s.link}>Password dimenticata?</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setMode("register")}>
                  <Text style={s.link}>Non hai un account? Registrati</Text>
                </TouchableOpacity>
              </>
            )}
            {mode === "register" && (
              <TouchableOpacity onPress={() => setMode("login")}>
                <Text style={s.link}>Hai già un account? Accedi</Text>
              </TouchableOpacity>
            )}
            {(mode === "verify" || mode === "forgot" || mode === "reset") && (
              <TouchableOpacity onPress={() => setMode("login")}>
                <Text style={s.link}>Torna all'accesso</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { padding: 28, paddingBottom: 60 },
  back: { marginBottom: 24 },
  backArrow: { color: theme.colors.textSecondary, fontSize: 14, letterSpacing: 0.5 },
  brand: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: "300",
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  title: {
    color: theme.colors.text,
    fontSize: 26,
    fontWeight: "400",
    letterSpacing: -0.5,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 24,
  },
  field: { marginBottom: 16 },
  label: {
    color: theme.colors.textSecondary,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
  },
  inputOtp: {
    fontSize: 24,
    letterSpacing: 8,
    textAlign: "center",
    fontWeight: "600",
  },
  primaryBtn: {
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "700", letterSpacing: 0.6 },
  links: { marginTop: 18, gap: 14, alignItems: "center" },
  link: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.4,
  },
});
