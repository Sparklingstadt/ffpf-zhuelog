import {
  isMemberRole,
  type AppRole,
  type AuthenticatedUser,
} from "@/domain/identity/entities/authenticated-user";

// What the app's navigation shows, in one place: the four main pages (the
// header links on wide screens), the five bottom tabs on phones and tablets,
// and the menu with everything else. Icons are chosen by the components.

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
const NOT_IN_DEMO = "デモ対象外";

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

// The header's link to the AI questions, after the four main pages: members
// only, and not the demo account, which Go refuses them.
export function aiHeaderLink(
  role: AppRole,
  { demo = false }: { demo?: boolean } = {},
): { label: string; href: string } | null {
  return isMemberRole(role) && !demo
    ? { label: "AI に聞く", href: "/quick-question" }
    : null;
}

// Whether a path is one of the AI pages the header's link covers.
export function isAiPath(pathname: string): boolean {
  return ["/quick-question", "/questions", "/chat", "/conversations"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export type BottomPage =
  "notes" | "review" | "line" | "quickQuestion" | "conversations";

export type BottomTab = {
  page: BottomPage;
  label: string;
  // Missing when the role may not open the page; the tab is then shown
  // disabled with `unavailable`.
  href?: string;
  unavailable?: string;
};

// The tabs at the bottom of phones and tablets. Guests get only the notes;
// the demo account has no LINE or AI questions (Go refuses them) but keeps
// its saved conversations.
export function bottomTabs(
  role: AppRole,
  { demo = false }: { demo?: boolean } = {},
): BottomTab[] {
  const member = isMemberRole(role);
  const forMembers = (href: string) =>
    member ? { href } : { unavailable: MEMBERS_ONLY };
  const notInDemo = (href: string) =>
    !member
      ? { unavailable: MEMBERS_ONLY }
      : demo
        ? { unavailable: NOT_IN_DEMO }
        : { href };
  return [
    { page: "notes", label: "学習ノート", href: "/" },
    { page: "review", label: "復習", ...forMembers("/review") },
    { page: "line", label: "LINE 連携", ...notInDemo("/account/line") },
    {
      page: "quickQuestion",
      label: "クイック質問",
      ...notInDemo("/quick-question"),
    },
    {
      page: "conversations",
      label: "会話ノート",
      ...forMembers("/conversations"),
    },
  ];
}

// Which bottom tab a path belongs to, for aria-current.
export function bottomPageOf(pathname: string): BottomPage | null {
  const under = (prefix: string) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`);
  const main = mainPageOf(pathname);
  if (main === "notes" || main === "review") return main;
  if (under("/account/line")) return "line";
  if (under("/quick-question")) return "quickQuestion";
  if (under("/conversations")) return "conversations";
  return null;
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
    { label: "練習の一覧", href: "/practice" },
    { label: "介詞の練習", href: "/practice/prepositions" },
    { label: "補語の練習", href: "/practice/complements" },
    { label: "量詞の練習", href: "/practice/measure-words" },
    { label: "了・过・着の練習", href: "/practice/aspect-particles" },
  ],
};

// The menu's sections for a role. The notes and the review are left out:
// they are always one tap away in the tabs or the header. Practice and the
// vocabulary are in it, since phones have no tab for them. The demo account (a member)
// gets no AI features, follows, LINE or password change: Go refuses them, so
// the menu leaves them out and keeps only the saved conversations.
export function menuSections(
  role: AppRole,
  { demo = false }: { demo?: boolean } = {},
): MenuSection[] {
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
        { label: "単語帳", href: "/vocabulary" },
      ],
    },
    PRACTICE,
  ];
  if (demo) {
    sections.push({
      title: "AI に聞く",
      links: [{ label: "会話ノート", href: "/conversations" }],
    });
    return sections;
  }
  sections.push(
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
  );
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
// would otherwise also claim the trash, and "/practice", whose drills have
// links of their own.
export function isCurrentLink(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/logs") return /^\/logs\/\d/.test(pathname);
  if (href === "/practice") return false;
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
  if (user.demo)
    return { name: user.displayName ?? user.githubLogin, roleLabel: "デモ" };
  return {
    name: user.displayName ?? user.githubLogin,
    roleLabel: "メンバー",
  };
}
