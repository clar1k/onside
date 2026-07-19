import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-space-grotesk)", ...defaultTheme.fontFamily.sans],
        mono: ["var(--font-jetbrains-mono)", ...defaultTheme.fontFamily.mono],
      },
      colors: {
        canvas: "hsl(var(--canvas) / <alpha-value>)",
        surface: "hsl(var(--surface) / <alpha-value>)",
        raised: "hsl(var(--raised) / <alpha-value>)",
        edge: "hsl(var(--edge) / <alpha-value>)",
        ink: "hsl(var(--ink) / <alpha-value>)",
        muted: "hsl(var(--muted) / <alpha-value>)",
        faint: "hsl(var(--faint) / <alpha-value>)",
        brand: { DEFAULT: "hsl(var(--brand) / <alpha-value>)", 600: "hsl(var(--brand-hover) / <alpha-value>)" },
        yes: { DEFAULT: "hsl(var(--yes) / <alpha-value>)", 600: "hsl(148 67% 40% / <alpha-value>)" },
        no: { DEFAULT: "hsl(var(--no) / <alpha-value>)", 600: "hsl(354 82% 58% / <alpha-value>)" },
        grass: "hsl(var(--yes) / <alpha-value>)",
      },
      borderRadius: {
        DEFAULT: "0.7rem",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.2s ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
