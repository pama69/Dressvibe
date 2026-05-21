import React, { createContext, useCallback, useContext, useRef, useState, ReactNode } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { theme } from "@/src/theme";

type ConfirmOptions = {
  title: string;
  message?: string;
  destructiveText?: string;
  cancelText?: string;
};

type NotifyOptions = {
  title: string;
  message?: string;
  okText?: string;
};

type ConfirmCtx = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  notify: (opts: NotifyOptions) => Promise<void>;
};

const Ctx = createContext<ConfirmCtx | undefined>(undefined);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [notifyOpts, setNotifyOpts] = useState<NotifyOptions | null>(null);
  const resolverRef = useRef<((b: boolean) => void) | null>(null);
  const notifyResolverRef = useRef<(() => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOpts(options);
    });
  }, []);

  const notify = useCallback((options: NotifyOptions) => {
    return new Promise<void>((resolve) => {
      notifyResolverRef.current = resolve;
      setNotifyOpts(options);
    });
  }, []);

  const onAnswer = (b: boolean) => {
    const r = resolverRef.current;
    resolverRef.current = null;
    setOpts(null);
    if (r) r(b);
  };

  const onNotifyClose = () => {
    const r = notifyResolverRef.current;
    notifyResolverRef.current = null;
    setNotifyOpts(null);
    if (r) r();
  };

  return (
    <Ctx.Provider value={{ confirm, notify }}>
      {children}
      <Modal
        visible={!!opts}
        transparent
        animationType="fade"
        onRequestClose={() => onAnswer(false)}
      >
        <View style={s.overlay}>
          <View style={s.box}>
            <Text style={s.title} testID="confirm-title">{opts?.title}</Text>
            {opts?.message ? <Text style={s.message}>{opts.message}</Text> : null}
            <View style={s.actions}>
              <TouchableOpacity
                onPress={() => onAnswer(false)}
                style={[s.btn, s.cancelBtn]}
                testID="confirm-cancel"
                activeOpacity={0.8}
              >
                <Text style={s.cancelText}>{opts?.cancelText || "Annulla"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onAnswer(true)}
                style={[s.btn, s.dangerBtn]}
                testID="confirm-ok"
                activeOpacity={0.85}
              >
                <Text style={s.dangerText}>{opts?.destructiveText || "Elimina"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Notify modal — single-button info dialog used as a reliable
          replacement for Alert.alert / window.alert. Critical inside the
          Emergent preview iframe where the browser silently blocks native
          alert() calls (no allow-modals sandbox flag). */}
      <Modal
        visible={!!notifyOpts}
        transparent
        animationType="fade"
        onRequestClose={onNotifyClose}
      >
        <View style={s.overlay}>
          <View style={s.box}>
            <Text style={s.title} testID="notify-title">{notifyOpts?.title}</Text>
            {notifyOpts?.message ? <Text style={s.message}>{notifyOpts.message}</Text> : null}
            <View style={[s.actions, { justifyContent: "flex-end" }]}>
              <TouchableOpacity
                onPress={onNotifyClose}
                style={[s.btn, s.okBtn]}
                testID="notify-ok"
                activeOpacity={0.85}
              >
                <Text style={s.okText}>{notifyOpts?.okText || "OK"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("ConfirmProvider missing in tree");
  return ctx.confirm;
}

export function useNotify() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("ConfirmProvider missing in tree");
  return ctx.notify;
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  box: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 22,
    ...(Platform.OS === "web" ? { boxShadow: "0 20px 60px rgba(0,0,0,0.6)" } : {}),
  },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: "500", letterSpacing: -0.3 },
  message: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 8, lineHeight: 19 },
  actions: { marginTop: 22, flexDirection: "row", gap: 10 },
  btn: { flex: 1, paddingVertical: 14, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  cancelBtn: { borderColor: theme.colors.border, backgroundColor: "transparent" },
  cancelText: { color: theme.colors.text, fontWeight: "500", letterSpacing: 0.3 },
  dangerBtn: { borderColor: theme.colors.error, backgroundColor: theme.colors.error },
  dangerText: { color: "#fff", fontWeight: "700", letterSpacing: 0.3 },
  okBtn: { borderColor: theme.colors.text, backgroundColor: theme.colors.text, paddingHorizontal: 28 },
  okText: { color: theme.colors.primaryFg, fontWeight: "700", letterSpacing: 0.3 },
});
