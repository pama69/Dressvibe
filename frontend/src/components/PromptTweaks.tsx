import React from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { theme } from "@/src/theme";

/**
 * Guided "ritocchi" for a generation prompt.
 *
 * A set of targeted, monkey-proof questions aimed at shop owners who are NOT
 * comfortable with prompt engineering. Each answer is optional and maps 1:1 to
 * a strong override directive on the backend (see compose_user_tweaks_suffix in
 * server.py). The same component is reused on the Studio screen to edit an
 * already-generated image with the exact same questions and logic.
 */
export type Tweaks = {
  remove: string;
  color: string;
  setting: string;
  pose: string;
  other: string;
};

export const EMPTY_TWEAKS: Tweaks = {
  remove: "",
  color: "",
  setting: "",
  pose: "",
  other: "",
};

/** True when at least one field has content — handy for badges/counters. */
export function hasTweaks(t: Tweaks): boolean {
  return Object.values(t).some((v) => v.trim().length > 0);
}

/** Map a Tweaks object to the backend `tweak_*` payload keys. */
export function tweaksToPayload(t: Tweaks) {
  const clean = (v: string) => {
    const s = v.trim();
    return s.length > 0 ? s : undefined;
  };
  return {
    tweak_remove: clean(t.remove),
    tweak_color: clean(t.color),
    tweak_setting: clean(t.setting),
    tweak_pose: clean(t.pose),
    tweak_other: clean(t.other),
  };
}

type QuestionDef = {
  key: keyof Tweaks;
  emoji: string;
  question: string;
  placeholder: string;
};

const QUESTIONS: QuestionDef[] = [
  {
    key: "remove",
    emoji: "🗑️",
    question: "Devo togliere qualcosa?",
    placeholder: "es. il cartellino, il logo, gli occhiali",
  },
  {
    key: "color",
    emoji: "🎨",
    question: "Devo cambiare qualche colore?",
    placeholder: "es. collana dorata invece che argento",
  },
  {
    key: "setting",
    emoji: "🖼️",
    question: "Devo cambiare lo sfondo o l'ambiente?",
    placeholder: "es. spiaggia al tramonto",
  },
  {
    key: "pose",
    emoji: "🧍",
    question: "Devo cambiare posa o espressione?",
    placeholder: "es. sorridente, di profilo",
  },
  {
    key: "other",
    emoji: "✏️",
    question: "Altro da sistemare?",
    placeholder: "es. manica arrotolata, luce più calda",
  },
];

export default function PromptTweaks({
  value,
  onChange,
  testIdScope = "tweaks",
}: {
  value: Tweaks;
  onChange: (t: Tweaks) => void;
  testIdScope?: string;
}) {
  const set = (key: keyof Tweaks, v: string) => onChange({ ...value, [key]: v });

  return (
    <View style={s.wrap}>
      {QUESTIONS.map((q) => (
        <View key={q.key} style={s.item}>
          <Text style={s.question}>
            {q.emoji}  {q.question}
          </Text>
          <TextInput
            value={value[q.key]}
            onChangeText={(v) => set(q.key, v)}
            placeholder={q.placeholder}
            placeholderTextColor={theme.colors.textMuted}
            style={s.input}
            maxLength={200}
            autoCapitalize="sentences"
            autoCorrect
            testID={`${testIdScope}-${q.key}`}
          />
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 14 },
  item: { gap: 6 },
  question: { color: theme.colors.text, fontSize: 13, fontWeight: "600", letterSpacing: 0.2 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    borderRadius: 10,
  },
});
