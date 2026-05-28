// =====================================================================
// packages/ui/src/tokens/colors.ts
// =====================================================================
// The dark luxury palette. Single source of truth — no other file in
// the codebase may declare a hex color for app surfaces.
// =====================================================================

export const colors = {
  bg: {
    base:         "#0a0a0b",   // page background
    surface:      "#111114",   // card / panel
    elevated:     "#17171c",   // modal / dropdown / popover
    inset:        "#0d0d10",   // inset wells, inputs at rest
    hover:        "#1c1c22",
    border:       "#1f1f26",
    borderStrong: "#2a2a33",
  },
  text: {
    primary:   "#e8e8ea",
    secondary: "#9d9da4",
    tertiary:  "#6b6b73",
    inverse:   "#0a0a0b",
    accent:    "#f4a522",
  },
  accent: {
    50:  "#fef7e7", 100: "#fde8b8", 200: "#fbd789", 300: "#f9c25a",
    400: "#f6ad36", 500: "#f4a522", 600: "#d18510", 700: "#a3650b",
    800: "#754808", 900: "#4a2d05",
  },
  semantic: {
    success: "#10b981",
    warning: "#f59e0b",
    danger:  "#ef4444",
    info:    "#3b82f6",
  },
  chart: ["#f4a522", "#10b981", "#3b82f6", "#a855f7", "#ec4899", "#06b6d4"],
} as const;
