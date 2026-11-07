import type { Metadata } from "next";
import { headers } from "next/headers";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { getCurrentViewerUser } from "@/composition/identity-container";
import { siteUrl } from "@/infrastructure/config/environment";
import { ThemeBootstrap } from "@/presentation/components/theme/theme-bootstrap";
import { ActingBanner } from "@/presentation/components/layout/acting-banner";
import { BottomNavigation } from "@/presentation/components/layout/bottom-navigation";
import "./globals.css";

// Request-specific CSP nonces cannot be used in a statically cached document.
export const dynamic = "force-dynamic";

const siteName = "学习録";
const description =
  "添削文・ピン音・学習ヒントをCSVから蓄積する中国語学習アプリ";

// OGP and the X card: src/app/opengraph-image.png (rendered from
// scripts/og-image/ by `pnpm run og:render`) is picked up by the file
// convention, and metadataBase turns it into an absolute URL.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${siteName} | 中国語学習ノート`,
    template: `%s | ${siteName}`,
  },
  description,
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName,
    title: `${siteName} | 中国語学習ノート`,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteName} | 中国語学習ノート`,
    description,
  },
};

// The banner must never take the page down with it (an unreachable API is
// the page's to report), and pages share the same cached GET /v1/me.
async function bannerUser() {
  try {
    return await getCurrentViewerUser();
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const user = await bannerUser();
  return (
    <html
      lang="ja"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <head>
        <ThemeBootstrap nonce={nonce} />
      </head>
      <body
        className={`flex min-h-full flex-col ${user ? "pb-[calc(5rem+1px+env(safe-area-inset-bottom))] xl:pb-0" : ""}`}
      >
        <ActingBanner user={user} />
        {children}
        {user ? <BottomNavigation role={user.role} /> : null}
      </body>
    </html>
  );
}
