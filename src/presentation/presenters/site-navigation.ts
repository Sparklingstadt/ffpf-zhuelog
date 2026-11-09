import {
  isMemberRole,
  type AppRole,
  type AuthenticatedUser,
} from "@/domain/identity/entities/authenticated-user";

// What the app's navigation shows, in one place: the four main pages (the
// bottom tabs on phones and tablets, the header links on wide screens) and
// the menu with everything else. Icons are chosen by the components.

export type MainPage = "notes" | "review" | "practice" | "vocabulary";

export type MainTab = {
  page: MainPage;
  // The bottom tab's short label and the header's longer one.
  label: string;
  headerLabel: string;
  // Missing when the role may not open the page (guests have no reviews or
  // vocabulary); the tab is then shown disabled with `unavailable`.
  href?: string;
  unavailable?: string;
};

export type MenuLink = { label: string; href: string };
export type MenuSection = { title: string; links: MenuLink[] };

const MEMBERS_ONLY = "メンバー向け";

export function mainTabs(role: AppRole): MainTab[] {
  const member = isMemberRole(role);
  return [
    {
      page: "notes",
      label: "学習ノート",
      headerLabel: "学習ノート",
      href: "/",
    },
    {
      page: "review",
      label: "復習",
      headerLabel: "今日の復習",
      ...(member ? { href: "/review" } : { unavailable: MEMBERS_ONLY }),
    },
    { page: "practice", label: "練習", headerLabel: "練習", href: "/practice" },
    {
      page: "vocabulary",
      label: "単語帳",
      headerLabel: "単語帳",
      ...(member ? { href: "/vocabulary" } : { unavailable: MEMBERS_ONLY }),
    },
  ];
}

// Which main page a path belongs to, for aria-current. Pages that only the
// menu links to (chat, follow, settings) belong to none.
export function mainPageOf(pathname: string): MainPage | null {
  const under = (prefix: string) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (
    pathname === "/" ||
    under("/logs") ||
    under("/import") ||
    under("/export")
  )
    return "notes";
  if (under("/review") || under("/study-log")) return "review";
  if (under("/practice")) return "practice";
  if (under("/vocabulary")) return "vocabulary";
  return null;
}

const PRACTICE: MenuSection = {
  title: "練習",
  links: [
    { label: "介詞の練習", href: "/practice/prepositions" },
    { label: "補語の練習", href: "/practice/complements" },
    { label: "量詞の練習", href: "/practice/measure-words" },
  ],
};

// The menu's sections for a role. The main pages are left out: they are
// always one tap away in the tabs or the header.
export function menuSections(role: AppRole): MenuSection[] {
  if (!isMemberRole(role)) return [PRACTICE];
  const sections: MenuSection[] = [
    {
      title: "学習ノート",
      links: [
        { label: "日付別の学習ノート", href: "/logs" },
        { label: "学習ログ（カレンダー）", href: "/study-log" },
        { label: "CSV を取り込む", href: "/import" },
        { label: "CSV に書き出す", href: "/export" },
        { label: "ゴミ箱", href: "/logs/trash" },
      ],
    },
    PRACTICE,
    {
      title: "AI に聞く",
      links: [
        { label: "ChatGPT と話す", href: "/chat" },
        { label: "会話ノート", href: "/conversations" },
        { label: "クイック質問", href: "/quick-question" },
      ],
    },
    {
      title: "つながり",
      links: [{ label: "フォロー", href: "/follow" }],
    },
    {
      title: "設定",
      links: [
        { label: "LINE 連携", href: "/account/line" },
        // Admins sign in with GitHub and have no password here. FFPF ID
        // members get a link to the portal on the same page.
        ...(role === "member"
          ? [{ label: "パスワード変更", href: "/account/password" }]
          : []),
      ],
    },
  ];
  if (role === "admin")
    sections.push({
      title: "管理",
      links: [
        { label: "アカウント管理", href: "/admin/accounts" },
        { label: "AI 利用量", href: "/admin/ai-usage" },
      ],
    });
  return sections;
}

// A link is current on its own path and below it, except "/logs", which
// would otherwise also claim the trash.
export function isCurrentLink(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/logs") return /^\/logs\/\d/.test(pathname);
  return pathname.startsWith(`${href}/`);
}

// How the signed-in person is named in the menu, and their role's label.
export function menuIdentity(user: AuthenticatedUser): {
  name: string;
  roleLabel: string;
} {
  if (user.role === "guest") return { name: "ゲスト", roleLabel: "ゲスト" };
  if (user.role === "admin")
    return { name: `@${user.githubLogin}`, roleLabel: "管理者" };
  return {
    name: user.displayName ?? user.githubLogin,
    roleLabel: "メンバー",
  };
}
