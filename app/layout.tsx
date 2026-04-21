import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
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
