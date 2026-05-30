export const typography = {
  fontFamily: {
    sans:    "'Inter', system-ui, -apple-system, sans-serif",
    mono:    "'JetBrains Mono', ui-monospace, monospace",
    display: "'Inter Display', 'Inter', sans-serif",
  },
  fontSize: {
    xs: "0.75rem", sm: "0.875rem", base: "0.9375rem", md: "1rem",
    lg: "1.125rem", xl: "1.375rem", "2xl": "1.75rem", "3xl": "2.25rem",
  },
  fontWeight: { normal: "400", medium: "500", semibold: "600" },
  letterSpacing: { tight: "-0.015em", normal: "0", wide: "0.05em" },
  lineHeight: { tight: "1.2", snug: "1.4", normal: "1.5", loose: "1.7" },
} as const;
