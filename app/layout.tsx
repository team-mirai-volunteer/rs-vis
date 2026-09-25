import type { Metadata, Viewport } from "next";
import { Lexend_Giga, Noto_Sans_JP } from "next/font/google";
import { SITE_URL } from "@/app/lib/site-url";
import { pageMetadata } from '@/app/lib/page-metadata';
import { AppHeaderProvider } from '@/components/navigation/AppHeader';
import "./globals.css";

// 和文フォント。400（本文）/ 500（中肉）/ 700（見出し）を最低限ロード
const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

// 数字・ロゴ周辺のアクセント英字（デザインシステム 2.2.4）。大きい数字は 500 を使うので 500 も読む
const lexendGiga = Lexend_Giga({
  variable: "--font-lexend-giga",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  ...pageMetadata('/'),
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
        <AppHeaderProvider>{children}</AppHeaderProvider>
      </body>
    </html>
  );
}
