import { Platform } from "react-native";

// Centralized theme tokens for DressVibe — "Noir Atelier" (dark editorial).
// The purple-navy ground is replaced by a neutral near-black; a single
// signature gradient ("Aurora": violet → rose → amber) is reserved for AI /
// magic actions. Surfaces read as glass (subtle white lift) with hairline
// borders. Keys are stable so every screen that references them re-skins for
// free; values are what changed.
export const theme = {
  colors: {
    bg: "#0B0B0F",           // neutral near-black ground
    surface: "#16161C",      // glass lift ≈ white 4.5% over bg
    surfaceAlt: "#1D1D24",   // glass lift ≈ white 7.5% over bg
    border: "rgba(255,255,255,0.09)",       // hairline
    borderStrong: "rgba(255,255,255,0.18)",
    text: "#F5F5F7",         // 15.8:1 on bg
    textSecondary: "#A6ABB8", // 8.3:1 on bg
    textMuted: "#7A8090",    // 4.8:1 on bg — still AA
    primary: "#F5F5F7",      // primary (non-AI) actions: near-white
    primaryFg: "#0B0B0F",
    // Aurora signature gradient stops (magic1→2→3 keeps the existing key
    // order so MAGIC_GRADIENT below becomes violet → rose → amber).
    magic1: "#7C5CFF",       // violet
    magic2: "#FF4D8D",       // rose
    magic3: "#FFB86B",       // amber
    glow: "rgba(255,77,141,0.40)",
    success: "#34D399",
    error: "#FB7185",
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
    sm: 13,
    md: 16,
    lg: 22,
    pill: 999,
  },
  font: {
    // Cross-platform serif for editorial display headings — no font files
    // shipped: iOS/web use Georgia, Android maps "serif" to its system serif.
    serif: Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" }) as string,
    display: Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" }) as string,
    sans: Platform.select({ ios: "System", android: "sans-serif", default: "System" }) as string,
  },
};

// Aurora — the one signature gradient, reserved for AI / magic actions.
export const MAGIC_GRADIENT: [string, string, string] = [
  theme.colors.magic1,
  theme.colors.magic2,
  theme.colors.magic3,
];
