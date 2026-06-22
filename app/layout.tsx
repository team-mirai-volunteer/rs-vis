import type { Metadata } from "next";
import { SITE_URL } from "@/app/lib/site-url";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "行政事業レビュー サンキー図 - 予算・支出可視化",
  description: "行政事業レビューシステムの予算・支出データをサンキー図で可視化",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
