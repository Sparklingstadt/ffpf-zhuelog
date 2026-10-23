import { viteBundler } from "@vuepress/bundler-vite";
import { defaultTheme } from "@vuepress/theme-default";
import { defineUserConfig } from "vuepress";

// Documentation site for the Go API in services/api. The sources are the
// specs under docs/superpowers/specs and the code itself; see docs-site/README.md.
export default defineUserConfig({
  lang: "ja-JP",
  title: "Zhuelog API",
  description: "学习録（Zhuelog）のネイティブアプリ向け Go API のドキュメント",
  bundler: viteBundler(),
  theme: defaultTheme({
    navbar: [
      { text: "概要", link: "/" },
      { text: "認証", link: "/guide/auth.md" },
      { text: "リファレンス", link: "/reference/" },
      { text: "エラー", link: "/errors.md" },
      {
        text: "運用",
        children: ["/operations/local.md", "/operations/deploy.md"],
      },
    ],
    sidebar: [
      { text: "概要", link: "/" },
      { text: "認証", link: "/guide/auth.md" },
      {
        text: "エンドポイント",
        link: "/reference/",
        children: [
          "/reference/auth.md",
          "/reference/entries.md",
          "/reference/trash.md",
          "/reference/sharing.md",
          "/reference/follows.md",
          "/reference/log-dates.md",
          "/reference/line.md",
          "/reference/admin.md",
          "/reference/health.md",
        ],
      },
      { text: "エラー", link: "/errors.md" },
      {
        text: "運用",
        children: ["/operations/local.md", "/operations/deploy.md"],
      },
    ],
    sidebarDepth: 2,
    // The site is not published from a fixed URL, so links to GitHub and git
    // metadata are left out.
    editLink: false,
    lastUpdated: false,
    contributors: false,
  }),
});
