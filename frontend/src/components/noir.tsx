// Noir Atelier — shared visual primitives (restyle 2026).
// Buttons/chips/cards/typography used identically across every screen so the
// look stays consistent without re-deriving the same StyleSheet 7 times.
import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ViewStyle,
  TextStyle,
  StyleProp,
  Image,
  ImageSourcePropType,
  Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { theme, MAGIC_GRADIENT, AURORA_ANGLE } from "@/src/theme";

const c = theme.colors;

// ---------- shadows ----------
export const shadowCard: ViewStyle = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 18 },
  shadowOpacity: 0.5,
  shadowRadius: 32,
  elevation: 10,
};
export const shadowAurora: ViewStyle = {
  shadowColor: c.magic2,
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.35,
  shadowRadius: 24,
  elevation: 12,
};

// ---------- typography ----------
export const type = StyleSheet.create({
  eyebrow: {
    fontSize: 10,
    letterSpacing: 4,
    textTransform: "uppercase",
    fontWeight: "600",
    color: c.textMuted,
  },
  display: {
    fontFamily: theme.font.serif,
    fontWeight: "500",
    letterSpacing: -0.5,
    lineHeight: 38,
    color: c.text,
  },
  h2: {
    fontSize: 12,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    fontWeight: "700",
    color: c.textSecondary,
  },
  sub: { color: c.textSecondary, fontSize: 14, lineHeight: 21 },
  micro: { color: c.textMuted, fontSize: 11, letterSpacing: 0.4 },
  label: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: c.textSecondary,
    textTransform: "uppercase",
    marginBottom: 7,
  },
});

// ---------- gradient text (the "Aurora = AI" signature effect) ----------
export function GradientText({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <MaskedView maskElement={<Text style={style}>{children}</Text>}>
      <LinearGradient colors={MAGIC_GRADIENT} {...AURORA_ANGLE}>
        <Text style={[style, { opacity: 0 }]}>{children}</Text>
      </LinearGradient>
    </MaskedView>
  );
}

// ---------- buttons ----------
type BtnVariant = "grad" | "white" | "ghost";
export function Button({
  children,
  onPress,
  variant = "white",
  small = false,
  disabled = false,
  style,
  textStyle,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  variant?: BtnVariant;
  small?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        btn.base,
        small ? btn.small : btn.regular,
        variant === "white" && { backgroundColor: c.primary },
        variant === "ghost" && {
          backgroundColor: c.surface,
          borderWidth: 1,
          borderColor: c.borderStrong,
        },
        variant === "grad" && shadowAurora,
        disabled && { opacity: 0.5 },
        pressed && !disabled && { opacity: 0.85 },
        style,
      ]}
    >
      {variant === "grad" && (
        <LinearGradient
          colors={MAGIC_GRADIENT}
          {...AURORA_ANGLE}
          style={StyleSheet.absoluteFill}
        />
      )}
      {typeof children === "string" ? (
        <Text
          style={[
            btn.text,
            variant === "grad" && { color: c.onGradient },
            variant === "white" && { color: c.primaryFg },
            variant === "ghost" && { color: c.text },
            small && { fontSize: 13 },
            textStyle,
          ]}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}
const btn = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: theme.radius.md,
    overflow: "hidden",
  },
  regular: { minHeight: 50, paddingHorizontal: 20, paddingVertical: 15 },
  small: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, borderRadius: theme.radius.sm },
  text: { fontSize: 14.5, fontWeight: "700", letterSpacing: 0.3 },
});

// ---------- chip ----------
export function Chip({
  children,
  active = false,
  onPress,
  style,
}: {
  children: React.ReactNode;
  active?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  if (active) {
    return (
      <Pressable onPress={onPress} style={[chip.wrapGrad, style]}>
        <LinearGradient colors={MAGIC_GRADIENT} {...AURORA_ANGLE} style={StyleSheet.absoluteFill} />
        <View style={chip.innerGrad}>
          <View style={chip.dot} />
          {typeof children === "string" ? (
            <Text style={[chip.text, { color: c.text }]}>{children}</Text>
          ) : (
            children
          )}
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} style={[chip.base, style]}>
      {typeof children === "string" ? <Text style={chip.text}>{children}</Text> : children}
    </Pressable>
  );
}
const chip = StyleSheet.create({
  base: {
    minHeight: 44,
    paddingHorizontal: 17,
    paddingVertical: 11,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  wrapGrad: {
    minHeight: 44,
    borderRadius: theme.radius.pill,
    padding: 1.5,
    shadowColor: c.magic2,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  innerGrad: {
    flex: 1,
    minHeight: 41,
    paddingHorizontal: 16,
    borderRadius: theme.radius.pill - 1.5,
    backgroundColor: c.bgElevated,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.magic2 },
  text: { fontSize: 13, fontWeight: "600", color: c.textSecondary },
});

// ---------- card ----------
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[card.base, style]}>{children}</View>;
}
const card = StyleSheet.create({
  base: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: theme.radius.lg,
    padding: 16,
  },
});

// ---------- badge (small gradient pill, always dark text — it's an AI marker) ----------
export function Badge({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[badge.wrap, style]}>
      <LinearGradient colors={MAGIC_GRADIENT} {...AURORA_ANGLE} style={StyleSheet.absoluteFill} />
      <Text style={badge.text}>{children}</Text>
    </View>
  );
}
const badge = StyleSheet.create({
  wrap: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: "hidden",
  },
  text: { color: c.onGradient, fontSize: 9, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
});

// ---------- skeleton (shimmer placeholder for in-flight generations) ----------
export function Skeleton({ width, height, radius = 14, style, delay = 0 }: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  delay?: number;
}) {
  const pulse = React.useRef(new Animated.Value(0.4)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, delay, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delay, pulse]);
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: c.surfaceAlt, opacity: pulse },
        style,
      ]}
    />
  );
}

// ---------- photo frame (real image + category/tag/remove chrome used on garment tiles) ----------
export function PhotoFrame({
  source,
  style,
  radius = theme.radius.lg,
  categoryLabel,
  tagLabel,
  onRemove,
  selected,
  dimmed,
  children,
}: {
  source: ImageSourcePropType;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  categoryLabel?: string;
  tagLabel?: string;
  onRemove?: () => void;
  selected?: boolean;
  dimmed?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View
      style={[
        { borderRadius: radius, overflow: "hidden", borderWidth: 1, borderColor: c.border },
        selected && { borderWidth: 2, borderColor: `${c.magic2}66` },
        dimmed && { opacity: 0.45 },
        style,
      ]}
    >
      <Image source={source} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.55)"]}
        locations={[0.55, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      {categoryLabel ? (
        <View style={ph.cat}>
          <Text style={ph.catText}>{categoryLabel}</Text>
        </View>
      ) : null}
      {onRemove ? (
        <Pressable onPress={onRemove} style={ph.x} hitSlop={6}>
          <Text style={{ color: "#fff", fontSize: 11 }}>✕</Text>
        </Pressable>
      ) : null}
      {tagLabel ? (
        <Text style={ph.tag} numberOfLines={1}>
          {tagLabel}
        </Text>
      ) : null}
      {selected ? (
        <Text style={ph.spark}>✦</Text>
      ) : null}
      {children}
    </View>
  );
}
const ph = StyleSheet.create({
  cat: {
    position: "absolute",
    left: 10,
    top: 10,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    borderRadius: theme.radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  catText: { color: "#fff", fontSize: 9, fontWeight: "700", letterSpacing: 1.4, textTransform: "uppercase" },
  x: {
    position: "absolute",
    right: 8,
    top: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  tag: {
    position: "absolute",
    left: 10,
    bottom: 10,
    color: "#fff",
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  spark: { position: "absolute", top: 5, right: 5, fontSize: 11, color: "#fff" },
});
