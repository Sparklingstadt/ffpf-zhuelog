import type { Metadata } from "next";
import { headers } from "next/headers";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { THEME_BOOTSTRAP_SCRIPT } from "@/infrastructure/theme/theme-bootstrap";
import { ThemeSwitcher } from "@/presentation/components/theme/theme-switcher";
import "./globals.css";

// Request-specific CSP nonces cannot be used in a statically cached document.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "学习録 | 中国語学習ノート",
  description: "添削文・ピン音・学習ヒントをCSVから蓄積する中国語学習アプリ",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="ja"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          id="theme-bootstrap"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <header className="mx-auto flex w-full max-w-6xl justify-end px-4 pt-4 sm:px-6 lg:px-8">
          <ThemeSwitcher />
        </header>
        {children}
      </body>
    </html>
  );
}
