import type { Config } from "tailwindcss";

/**
 * チームみらい デザインシステムのトークンを Tailwind v3 のクラスとして公開する。
 * hex は app/globals.css の CSS 変数にのみ置き、ここでは参照だけする。
 */
/** hex トークンの RGB チャンネル版を参照し、`bg-primary/10` のような不透明度修飾子を有効にする */
const withAlpha = (rgbVar: string) => `rgb(var(${rgbVar}) / <alpha-value>)`;

export default {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./client/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-noto-sans-jp)", "var(--font-fallback)"],
        lexend: ["var(--font-lexend-giga)", "var(--font-fallback)"],
      },
      colors: {
        background: withAlpha("--background-rgb"),
        foreground: withAlpha("--foreground-rgb"),
        card: { DEFAULT: withAlpha("--card-rgb"), foreground: "var(--card-foreground)" },
        popover: { DEFAULT: "var(--popover)", foreground: "var(--popover-foreground)" },
        primary: {
          DEFAULT: withAlpha("--primary-rgb"),
          accent: withAlpha("--primary-accent-rgb"),
          foreground: "var(--primary-foreground)",
        },
        secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
        destructive: withAlpha("--destructive-rgb"),
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        mirai: {
          text: {
            DEFAULT: withAlpha("--mirai-text-rgb"),
            secondary: "var(--mirai-text-secondary)",
            muted: withAlpha("--mirai-text-muted-rgb"),
            placeholder: "var(--mirai-text-placeholder)",
            note: "var(--mirai-text-note)",
            subtle: "var(--mirai-text-subtle)",
            close: "var(--mirai-text-close)",
          },
          surface: {
            DEFAULT: withAlpha("--mirai-surface-rgb"),
            light: "var(--mirai-surface-light)",
            grouped: "var(--mirai-surface-grouped)",
            muted: "var(--mirai-surface-muted)",
            tag: "var(--mirai-surface-tag)",
            warm: "var(--mirai-surface-warm)",
            gray: "var(--mirai-surface-gray)",
            teal: withAlpha("--mirai-surface-teal-rgb"),
          },
          border: {
            DEFAULT: withAlpha("--mirai-border-rgb"),
            light: "var(--mirai-border-light)",
            muted: "var(--mirai-border-muted)",
          },
          "reaction-active": "var(--mirai-reaction-active)",
          star: "var(--mirai-star)",
          highlight: "var(--mirai-highlight)",
          "badge-yellow": "var(--mirai-badge-yellow)",
          "info-blue": "var(--mirai-info-blue)",
          "progress-track": "var(--mirai-progress-track)",
          "progress-fill": "var(--mirai-progress-fill)",
          "gradient-start": "var(--mirai-gradient-start)",
          "gradient-end": "var(--mirai-gradient-end)",
        },
        /** 状態の意味色（データのエンコーディング専用）。text-status-warn / bg-status-bad-bg など */
        status: {
          good: { DEFAULT: "var(--status-good)", bg: "var(--status-good-bg)", fg: "var(--status-good-fg)", bar: "var(--status-good-bar)" },
          warn: { DEFAULT: "var(--status-warn)", bg: "var(--status-warn-bg)", fg: "var(--status-warn-fg)", bar: "var(--status-warn-bar)" },
          caution: { DEFAULT: "var(--status-caution)", bg: "var(--status-caution-bg)", fg: "var(--status-caution-fg)", bar: "var(--status-caution-bar)" },
          bad: { DEFAULT: "var(--status-bad)", bg: "var(--status-bad-bg)", fg: "var(--status-bad-fg)", bar: "var(--status-bad-bar)" },
        },
        stance: {
          "for-bg": "var(--stance-for-bg)",
          against: { DEFAULT: "var(--stance-against)", bg: "var(--stance-against-bg)" },
          neutral: { DEFAULT: "var(--stance-neutral)", "badge-bg": "var(--stance-neutral-badge-bg)" },
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        soft: "0 2px 8px 0 rgb(0 0 0 / 0.06)",
      },
      spacing: {
        13: "3.25rem",
      },
      lineHeight: {
        relaxed: "1.875",
      },
    },
  },
  plugins: [],
} satisfies Config;
