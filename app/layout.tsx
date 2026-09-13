import type { Metadata, Viewport } from "next";
import { Lexend_Giga, Noto_Sans_JP } from "next/font/google";
import { SITE_URL } from "@/app/lib/site-url";
import "./globals.css";

// 和文フォント。400（本文）/ 500（中肉）/ 700（見出し）を最低限ロード
const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

// 英数字の見出し強調用（任意）
const lexendGiga = Lexend_Giga({
  variable: "--font-lexend-giga",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "行政事業レビュー サンキー図 - 予算・支出可視化",
  description: "行政事業レビューシステムの予算・支出データをサンキー図で可視化",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2aa693",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body
        className={`${notoSansJP.variable} ${lexendGiga.variable} font-sans antialiased bg-background text-foreground`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
