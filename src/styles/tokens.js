// Design Tokens & Theme System
// Extracted from App.jsx monolith — Phase 1

import { useState, useEffect } from "react";

// ── Theme Definitions ──────────────────────────────────────────────
export const THEMES = {
  dark: {
    name: "Dark",
    bg: "#060a11", bg2: "#0b1120", panel: "#0f1629", card: "#131c30", cardH: "#182240",
    input: "#162035", border: "#1c2d4a", borderL: "#253a5e",
    text: "#e4eaf4", soft: "#8b9dc3", dim: "#6b82a8", faint: "#283854",
    accent: "#22d3a0", accentD: "#22d3a018", accentM: "#22d3a033",
    blue: "#38bdf8", blueD: "#38bdf818",
    purple: "#a78bfa", purpleD: "#a78bfa18",
    orange: "#fb923c", orangeD: "#fb923c18",
    pink: "#f472b6", pinkD: "#f472b618",
    red: "#ef4444", redD: "#ef444418",
    yellow: "#facc15", yellowD: "#facc1518",
    cyan: "#22d3ee", cyanD: "#22d3ee18",
  },
  light: {
    name: "Light",
    bg: "#f0f4f8", bg2: "#e8edf2", panel: "#ffffff", card: "#ffffff", cardH: "#f5f8fc",
    input: "#edf1f7", border: "#d0d8e4", borderL: "#b0bdd0",
    text: "#0f1726", soft: "#2d3f58", dim: "#5a7390", faint: "#b8c6d8",
    accent: "#047857", accentD: "#04785728", accentM: "#04785744",
    blue: "#1d4ed8", blueD: "#1d4ed822",
    purple: "#6d28d9", purpleD: "#6d28d920",
    orange: "#c2410c", orangeD: "#c2410c22",
    pink: "#be185d", pinkD: "#be185d20",
    red: "#b91c1c", redD: "#b91c1c20",
    yellow: "#92400e", yellowD: "#92400e20",
    cyan: "#0e7490", cyanD: "#0e749020",
  },
  warm: {
    name: "Warm",
    bg: "#1a1410", bg2: "#231c14", panel: "#2a2018", card: "#302620", cardH: "#3a2e24",
    input: "#2a2018", border: "#4a3828", borderL: "#5a4838",
    text: "#f5e6d3", soft: "#c4a882", dim: "#8a7460", faint: "#5a4838",
    accent: "#e8a855", accentD: "#e8a85518", accentM: "#e8a85533",
    blue: "#64b5f6", blueD: "#64b5f618",
    purple: "#ce93d8", purpleD: "#ce93d818",
    orange: "#ffb74d", orangeD: "#ffb74d18",
    pink: "#f48fb1", pinkD: "#f48fb118",
    red: "#ef5350", redD: "#ef535018",
    yellow: "#fff176", yellowD: "#fff17618",
    cyan: "#4dd0e1", cyanD: "#4dd0e118",
  },
  mono: {
    name: "Mono",
    bg: "#0a0a0a", bg2: "#141414", panel: "#1a1a1a", card: "#1e1e1e", cardH: "#262626",
    input: "#1a1a1a", border: "#333333", borderL: "#444444",
    text: "#e0e0e0", soft: "#999999", dim: "#808080", faint: "#444444",
    accent: "#ffffff", accentD: "#ffffff18", accentM: "#ffffff33",
    blue: "#bbbbbb", blueD: "#bbbbbb18",
    purple: "#aaaaaa", purpleD: "#aaaaaa18",
    orange: "#cccccc", orangeD: "#cccccc18",
    pink: "#dddddd", pinkD: "#dddddd18",
    red: "#ff6666", redD: "#ff666618",
    yellow: "#eeeeee", yellowD: "#eeeeee18",
    cyan: "#cccccc", cyanD: "#cccccc18",
  },
  ocean: {
    name: "Ocean",
    bg: "#0a1628", bg2: "#0f1d32", panel: "#132440", card: "#162a4a", cardH: "#1a3358",
    input: "#132440", border: "#1e3a5f", borderL: "#2a4a70",
    text: "#e0ecff", soft: "#7da8d4", dim: "#6a94be", faint: "#2a4a70",
    accent: "#00d4aa", accentD: "#00d4aa18", accentM: "#00d4aa33",
    blue: "#4fc3f7", blueD: "#4fc3f718",
    purple: "#b39ddb", purpleD: "#b39ddb18",
    orange: "#ffab40", orangeD: "#ffab4018",
    pink: "#f48fb1", pinkD: "#f48fb118",
    red: "#ff5252", redD: "#ff525218",
    yellow: "#ffee58", yellowD: "#ffee5818",
    cyan: "#26c6da", cyanD: "#26c6da18",
  },
};

// ── Theme State (pub/sub) ──────────────────────────────────────────
let _activeTheme = "dark";
let _themeSubs = [];
let _fontScale = 115; // 115% base scale for readability (modern UX: 14-16px body text)

export function fs(px) {
  return Math.max(12, Math.round(px * _fontScale / 100));
}

export function setFontScale(scale) {
  _fontScale = scale;
}

export function getFontScale() {
  return _fontScale;
}

export function getTheme() {
  return THEMES[_activeTheme] || THEMES.dark;
}

export function getThemeName() {
  return _activeTheme;
}

// Sync CSS custom properties to :root for CSS Modules
export function syncCssVariables() {
  const t = THEMES[_activeTheme] || THEMES.dark;
  const root = document.documentElement;
  // Set every theme token as a CSS variable
  for (const [key, value] of Object.entries(t)) {
    if (key === "name") continue;
    root.style.setProperty(`--${key}`, value);
  }
  // Set color-scheme
  root.style.setProperty("color-scheme", _activeTheme === "light" ? "light" : "dark");
}

export function setTheme(name) {
  _activeTheme = name;
  syncCssVariables();
  _themeSubs.forEach(fn => fn(name));
}

export function useTheme() {
  const [t, setT] = useState(_activeTheme);
  useEffect(() => {
    _themeSubs.push(setT);
    return () => { _themeSubs = _themeSubs.filter(fn => fn !== setT); };
  }, []);
  return THEMES[t] || THEMES.dark;
}

// Initialize CSS variables on load
if (typeof document !== "undefined") {
  syncCssVariables();
}

// ── Design Tokens ──────────────────────────────────────────────────
export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48,
};

export const radius = {
  sm: 6, md: 10, lg: 14, xl: 18, pill: 999,
};

export const typography = {
  h1: { fontSize: 28, fontWeight: 800, fontFamily: "'Outfit', sans-serif", letterSpacing: "-0.5px" },
  h2: { fontSize: 22, fontWeight: 700, fontFamily: "'Outfit', sans-serif", letterSpacing: "-0.3px" },
  h3: { fontSize: 17, fontWeight: 700, fontFamily: "'Outfit', sans-serif" },
  body: { fontSize: 14, fontWeight: 400, fontFamily: "'DM Sans', sans-serif" },
  caption: { fontSize: 11, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", letterSpacing: "0.5px", textTransform: "uppercase" },
  mono: { fontSize: 12, fontWeight: 500, fontFamily: "'JetBrains Mono', monospace" },
};

export const FONTS_URL = "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&family=DM+Sans:wght@300;400;500;600;700&display=swap";
