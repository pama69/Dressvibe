import React from "react";
import { StyleSheet, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

/** Dark glass-like card with a subtle indigo-to-violet gradient and faint glow border. */
export function LiquidCard({
  style,
  children,
  colors = CARD_GRAD,
  ...props
}: {
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
  colors?: [string, string, ...string[]];
  [k: string]: any;
}) {
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0.05, y: 0 }}
      end={{ x: 0.95, y: 1 }}
      style={[styles.card, style]}
      {...props}
    >
      {children}
    </LinearGradient>
  );
}

export const CARD_GRAD: [string, string] = ["#2e2b60", "#1e1c48"];
export const CHIP_GRAD: [string, string] = ["#28265a", "#1c1a44"];
export const BLOCK_GRAD: [string, string] = ["#252252", "#1a1840"];

const styles = StyleSheet.create({
  card: { overflow: "hidden" },
});
