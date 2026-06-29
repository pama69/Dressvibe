// Centralized theme tokens for DressVibe (dark, high-fashion editorial)
export const theme = {
  colors: {
    bg: "#07070f",
    surface: "#111128",
    surfaceAlt: "#191930",
    border: "rgba(180,150,255,0.14)",
    borderStrong: "rgba(180,150,255,0.32)",
    text: "#FAFAFA",
    textSecondary: "#A1A1AA",
    textMuted: "#71717A",
    primary: "#FFFFFF",
    primaryFg: "#000000",
    magic1: "#F59E0B",
    magic2: "#E11D48",
    magic3: "#9D4CDD",
    glow: "rgba(225,29,72,0.4)",
    success: "#10B981",
    error: "#EF4444",
    overlay: "rgba(0,0,0,0.6)",
  },
  space: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  radius: {
    none: 0,
    xs: 2,
    sm: 4,
    md: 8,
    pill: 999,
  },
  font: {
    serif: "Cormorant Garamond",
    sans: "Outfit",
  },
};

export const MAGIC_GRADIENT: [string, string, string] = [
  theme.colors.magic1,
  theme.colors.magic2,
  theme.colors.magic3,
];
