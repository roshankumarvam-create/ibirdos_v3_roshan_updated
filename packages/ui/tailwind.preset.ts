import type { Config } from "tailwindcss";
import { colors, spacing, typography } from "./src/tokens";

const preset: Partial<Config> = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: colors.bg,
        text: {
          primary:   colors.text.primary,
          secondary: colors.text.secondary,
          tertiary:  colors.text.tertiary,
          inverse:   colors.text.inverse,
        },
        accent: colors.accent,
        success: colors.semantic.success,
        warning: colors.semantic.warning,
        danger:  colors.semantic.danger,
        info:    colors.semantic.info,
      },
      fontFamily: typography.fontFamily,
      fontSize: typography.fontSize,
      letterSpacing: typography.letterSpacing,
      borderRadius: spacing.radius,
      boxShadow: spacing.shadow,
    },
  },
};

export default preset;
