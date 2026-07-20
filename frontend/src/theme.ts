// Centralized theme tokens for DressVibe — "Noir Atelier" (dark, editorial, glass)
import { Platform } from "react-native";

export const theme = {
  colors: {
    bg: "#0B0B0F",
    bgElevated: "#101016",
    surface: "rgba(255,255,255,0.045)",
    surfaceAlt: "rgba(255,255,255,0.075)",
    border: "rgba(255,255,255,0.09)",
    borderStrong: "rgba(255,255,255,0.18)",
    text: "#F5F5F7",
    textSecondary: "#A6ABB8",
    textMuted: "#7A8090",
    primary: "#F5F5F7",
    primaryFg: "#0B0B0F",
    // Aurora — signature AI gradient (violet → rose → amber). Never used decoratively,
    // only where the AI is acting (generate CTA, magic tweaks, active states, badges).
    magic1: "#7C5CFF",
    magic2: "#FF4D8D",
    magic3: "#FFB86B",
    onGradient: "#14060B",
    glow: "rgba(255,77,141,0.3)",
    success: "#34D399",
    error: "#FB7185",
    overlay: "rgba(0,0,0,0.55)",
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
    sm: 13,
    md: 16,
    lg: 22,
    pill: 999,
  },
  font: {
    serif: Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" }),
    sans: Platform.select({ ios: "System", android: "sans-serif", default: undefined }),
  },
};

export const MAGIC_GRADIENT: [string, string, string] = [
  theme.colors.magic1,
  theme.colors.magic2,
  theme.colors.magic3,
];

export const AURORA_ANGLE = { start: { x: 0, y: 0.3 }, end: { x: 1, y: 0.7 } };
