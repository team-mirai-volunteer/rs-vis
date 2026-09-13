/**
 * layout.tsx — チームみらい Web の Root Layout 完全テンプレート
 *
 * 出典:
 * - mirai-gikai/web/src/app/layout.tsx (https://github.com/team-mirai/mirai-gikai/blob/develop/web/src/app/layout.tsx)
 * - marumie/webapp/src/app/layout.tsx (https://github.com/team-mirai/marumie/blob/develop/webapp/src/app/layout.tsx)
 * - action-board/src/app/layout.tsx (https://github.com/team-mirai-volunteer/action-board/blob/develop/src/app/layout.tsx)
 *
 * 使い方: app/layout.tsx にコピペして、metadata の文字列と children の中身（Header/Footer）を入れ替えるだけ。
 *
 * 必須ポイント:
 * 1. <html lang="ja"> を必ず指定
 * 2. Noto_Sans_JP を変数化して body の className に当てる
 * 3. bg-background text-foreground で warm gray 背景 + dark text を default にする
 * 4. themeColor: "#2aa693" でモバイルブラウザのナビバーを brand 色に
 * 5. NextTopLoader を入れて遷移時のプログレスバーも brand 色に
 */

import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Lexend_Giga, Noto_Sans_JP } from "next/font/google";
import NextTopLoader from "nextjs-toploader";
import type { ReactNode } from "react";

// 和文フォント。weight は 400 (本文) / 500 (中肉本文) / 700 (見出し) の 3 つを最低限ロード
const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

// 英数字の見出し強調用（gikai の Scroll / About 見出しなどで使う）。任意
const lexendGiga = Lexend_Giga({
  variable: "--font-lexend-giga",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800", "900"],
});

const SITE_TITLE = "プロダクト名｜チームみらい";
const SITE_DESCRIPTION = "プロダクトの一行説明";
const SITE_NAME = "プロダクト名";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    images: [
      {
        url: "/ogp.jpg",
        width: 1200,
        height: 630,
        alt: SITE_NAME,
      },
    ],
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/ogp.jpg"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#2aa693", // チームみらいの primary teal をモバイル UI に反映
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${notoSansJP.variable} ${lexendGiga.variable} font-sans antialiased bg-background text-foreground`}
      >
        {/* ページ遷移時のプログレスバーを brand 色に */}
        <NextTopLoader showSpinner={false} color="#2aa693" />

        {/* Header / Footer はここで囲うか、(main) layout で囲う */}
        {children}
      </body>
    </html>
  );
}
